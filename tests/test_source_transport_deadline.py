"""Exercise deadlines below HTTP framing, using real local sockets only."""

from contextlib import ExitStack, contextmanager
from concurrent.futures import ThreadPoolExecutor
from http.client import HTTPResponse, HTTPSConnection
import socket
import ssl
import threading
import time
from urllib.request import ProxyHandler, build_opener

import pytest

from scripts import scrape_character_usage as scraper


BODY = b'{"ok":true}'
HEADERS = b'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n'


@contextmanager
def wire_socket(initial, slow=b"", final=b"", *, timeout=0.2, delay=0.01):
    client, server = socket.socketpair()
    client.settimeout(timeout)
    stopped = threading.Event()

    def write():
        try:
            server.sendall(initial)
            for byte in slow:
                if stopped.wait(delay):
                    return
                server.sendall(bytes([byte]))
            server.sendall(final)
            # The real-opener tests send request bytes in the other direction.
            # Keep the peer open until the client has consumed the response;
            # closing with unread request bytes can inject an unrelated reset.
            stopped.wait(2)
        except OSError:
            pass  # A timed-out client is expected to close the connection.
        finally:
            server.close()

    writer = threading.Thread(target=write)
    writer.start()
    try:
        yield client
    finally:
        client.close()
        stopped.set()
        writer.join(timeout=2)
        assert not writer.is_alive()


@contextmanager
def wire_response(*args, **kwargs):
    with wire_socket(*args, **kwargs) as client:
        response_class = getattr(scraper, "SourceHTTPResponse", HTTPResponse)
        with response_class(client) as response:
            yield response


@pytest.mark.parametrize("stage", ["headers", "chunk_header", "chunk_end", "trailer", "body"])
def test_trickling_protocol_reads_stop_before_waiting_for_the_whole_line(monkeypatch, stage):
    monkeypatch.setattr(scraper, "REQUEST_TIMEOUT_SECONDS", 0.2)
    if stage == "headers":
        initial = b'HTTP/1.1 200 OK\r\nX-Probe: '
        slow = b'x' * 100 + b'\r\nTransfer-Encoding: chunked\r\n\r\n'
        final = b'b\r\n' + BODY + b'\r\n0\r\n\r\n'
    elif stage == "chunk_header":
        initial, slow = HEADERS, b'b;' + b'x' * 100 + b'\r\n'
        final = BODY + b'\r\n0\r\n\r\n'
    elif stage == "trailer":
        initial = HEADERS + b'b\r\n' + BODY + b'\r\n0\r\n'
        slow, final = b'X-Probe: ' + b'x' * 100 + b'\r\n', b'\r\n'
    elif stage == "chunk_end":
        initial = HEADERS + b'b\r\n' + BODY
        slow, final = b'\r\n', b'0\r\n\r\n'
    else:
        initial = b'HTTP/1.1 200 OK\r\nContent-Length: 102\r\n\r\n'
        slow, final = b'"' + b'x' * 100 + b'"', b''
    delay = 0.15 if stage == "chunk_end" else 0.01
    with wire_response(initial, slow, final, delay=delay) as response:
        started = time.monotonic()
        with pytest.raises(TimeoutError):
            response.begin()
            scraper._read_json_response(response, "Offline probe")
        elapsed = time.monotonic() - started
        # Loose enough for CI scheduling, but not a one-second framing wait.
        assert elapsed < (0.29 if stage == "chunk_end" else 0.7)


@pytest.mark.parametrize("chunked", [False, True])
def test_complete_response_keeps_its_normal_parse_and_resource_lifecycle(chunked):
    wire = (HEADERS + b'b\r\n' + BODY + b'\r\n0\r\n\r\n' if chunked else
            b'HTTP/1.1 200 OK\r\nContent-Length: 11\r\n\r\n' + BODY)
    with wire_response(wire, timeout=1) as response:
        response.begin()
        assert scraper._read_json_response(response, "Offline probe") == {"ok": True}
        assert response.isclosed()


def test_tls_verification_and_redirect_allowlist_remain_enabled():
    connection_class = getattr(scraper, "SourceHTTPSConnection", HTTPSConnection)
    connection = connection_class("rangers.lerico.net", timeout=15)
    try:
        assert connection._context.check_hostname
        assert connection._context.verify_mode == ssl.CERT_REQUIRED
    finally:
        connection.close()
    assert scraper.is_trusted_source_url("https://rangers.lerico.net/api/v2/translate")
    assert not scraper.is_trusted_source_url("http://rangers.lerico.net/api/v2/translate")
    assert not scraper.is_trusted_source_url("https://example.invalid/api/v2/translate")


@pytest.mark.parametrize("stage", ["headers", "trailer"])
@pytest.mark.parametrize("recover", [True, False])
def test_real_opener_deadlines_use_existing_retries_and_release_connections(monkeypatch, stage, recover):
    monkeypatch.setattr(scraper, "REQUEST_TIMEOUT_SECONDS", 0.12)
    monkeypatch.setattr(scraper, "sleep", lambda _: None)
    sockets = []
    with ExitStack() as stack:
        def connect(connection):
            if recover and sockets:
                wire = b'HTTP/1.1 200 OK\r\nContent-Length: 11\r\n\r\n' + BODY
                args = (wire,)
            elif stage == "headers":
                args = (b'HTTP/1.1 200 OK\r\nX-Probe: ', b'x' * 100, b'\r\n\r\n')
            else:
                args = (HEADERS + b'b\r\n' + BODY + b'\r\n0\r\n',
                        b'X-Probe: ' + b'x' * 100, b'\r\n\r\n')
            connection.sock = stack.enter_context(wire_socket(*args, timeout=connection.timeout))
            sockets.append(connection.sock)

        # Only the connection is replaced. Exercise real urllib getresponse,
        # handler routing, framing, closure, exception conversion and retry.
        monkeypatch.setattr(scraper.SourceHTTPSConnection, "connect", connect)
        opener = build_opener(ProxyHandler({}), scraper.SourceOnlyRedirectHandler(), scraper.SourceHTTPSHandler())
        monkeypatch.setattr(scraper, "SOURCE_OPENER", opener)
        url = "https://rangers.lerico.net/api/v2/pvp/league/rank/LEGEND"
        if recover:
            assert scraper.fetch_json(url, "Ranking") == {"ok": True}
            assert len(sockets) == 2
        else:
            with pytest.raises(RuntimeError) as error:
                scraper.fetch_json(url, "Ranking")
            assert "x" * 10 not in str(error.value)
            assert len(sockets) == scraper.REQUEST_ATTEMPTS
        # Verify urllib released the underlying descriptors, not just a flag.
        assert all(sock.fileno() == -1 for sock in sockets)


def test_header_wait_does_not_consume_body_allowance(monkeypatch):
    import io

    clock = [0.0]
    monkeypatch.setattr(scraper, "monotonic", lambda: clock[0])

    class Socket:
        timeout = 15

        def gettimeout(self):
            return self.timeout

        def settimeout(self, timeout):
            self.timeout = timeout

        def makefile(self, *args):
            return io.BufferedReader(Raw())

    class Raw(io.RawIOBase):
        chunks = iter([b'HTTP/1.1 200 OK\r\nContent-Length: 11\r\n\r\n', BODY])

        def readable(self):
            return True

        def readinto(self, buffer):
            chunk = next(self.chunks, b'')
            if chunk:
                clock[0] += 10
            buffer[:len(chunk)] = chunk
            return len(chunk)

    with scraper.SourceHTTPResponse(Socket()) as response:
        response.begin()
        assert scraper._read_json_response(response, "Offline probe") == {"ok": True}
    assert clock[0] == 20  # Each 10-second phase fits its own 15-second budget.


def test_parallel_response_deadlines_do_not_cancel_a_healthy_request():
    def receive(slow):
        if slow:
            args = (HEADERS, b'b;' + b'x' * 100, b'\r\n' + BODY + b'\r\n0\r\n\r\n')
        else:
            args = (b'HTTP/1.1 200 OK\r\nContent-Length: 11\r\n\r\n' + BODY,)
        with wire_response(*args, timeout=0.12 if slow else 1) as response:
            response.begin()
            try:
                return scraper._read_json_response(response, "Offline probe")
            except TimeoutError:
                return "timed_out"

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert list(executor.map(receive, [True, False])) == ["timed_out", {"ok": True}]


def test_proxy_tunnel_preserves_full_timeout_for_following_tls_handshake():
    with wire_socket(b'HTTP/1.1 200 Connection established\r\nX-Probe: ',
                     b'abc\r\n\r\n', timeout=1) as client:
        connection = scraper.SourceHTTPSConnection("proxy.example.invalid", timeout=1)
        connection.set_tunnel("rangers.lerico.net")
        connection.sock = client
        try:
            connection._tunnel()
            assert client.gettimeout() == 1
        finally:
            connection.close()


@pytest.mark.parametrize("malformed", [b'INVALID-STATUS\r\n',
    b'HTTP/1.1 200 OK\r\nX-Probe: ' + b'x' * 65536 + b'\r\n\r\n'],
    ids=["status_line", "header_too_long"])
@pytest.mark.parametrize("recover", [True, False])
def test_protocol_errors_use_bounded_sanitized_retries(monkeypatch, malformed, recover):
    sockets = []
    monkeypatch.setattr(scraper, "sleep", lambda _: None)
    with ExitStack() as stack:
        def connect(connection):
            wire = (b'HTTP/1.1 200 OK\r\nContent-Length: 11\r\n\r\n' + BODY
                    if recover and sockets else malformed)
            connection.sock = stack.enter_context(wire_socket(wire, timeout=1))
            sockets.append(connection.sock)

        monkeypatch.setattr(scraper.SourceHTTPSConnection, "connect", connect)
        monkeypatch.setattr(scraper, "SOURCE_OPENER", build_opener(
            ProxyHandler({}), scraper.SourceOnlyRedirectHandler(), scraper.SourceHTTPSHandler()))
        url = "https://rangers.lerico.net/api/v2/pvp/league/rank/LEGEND"
        if recover:
            assert scraper.fetch_json(url, "Ranking") == {"ok": True}
            assert len(sockets) == 2
        else:
            with pytest.raises(RuntimeError) as error:
                scraper.fetch_json(url, "Ranking")
            assert "INVALID-STATUS" not in str(error.value)
            assert "x" * 10 not in str(error.value)
            assert len(sockets) == scraper.REQUEST_ATTEMPTS
        assert all(sock.fileno() == -1 for sock in sockets)
