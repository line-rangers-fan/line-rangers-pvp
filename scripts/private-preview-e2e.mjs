import assert from "node:assert/strict";

const base = String(process.env.PRIVATE_PREVIEW_BASE_URL || "").replace(/\/+$/, "");
const accessToken = process.env.BOARD_OWNER_ACCESS_TOKEN || "";
const entryPath = process.env.PRIVATE_PREVIEW_ENTRY_PATH || "/__private/owner-entry-6d3c9a21b7e84f0c5a6e2d9f1b8c7340";
assert.ok(/^https:\/\//.test(base), "PRIVATE_PREVIEW_BASE_URL must be HTTPS");
assert.ok(accessToken, "BOARD_OWNER_ACCESS_TOKEN is required");

const cookies = new Map();
let cleanupBoardId = "";
let cleanupGroup = "";
let cleanupCompleted = false;

function saveCookies(response) {
  let values = [];
  if (typeof response.headers.getSetCookie === "function") {
    values = response.headers.getSetCookie();
  } else {
    const combined = response.headers.get("set-cookie");
    values = combined ? combined.split(/,(?=\s*__Host-)/) : [];
  }
  for (const value of values) {
    const pair = value.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

function cookieHeader() {
  return [...cookies.entries()].map(([name, value]) => name + "=" + value).join("; ");
}

async function request(path, init = {}) {
  const headers = new Headers(init.headers || {});
  if (!headers.has("origin")) headers.set("origin", base);
  if (!headers.has("sec-fetch-site")) headers.set("sec-fetch-site", "same-origin");
  const cookie = cookieHeader();
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(base + path, {
    ...init,
    headers,
    redirect: "manual",
  });
  saveCookies(response);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  return { response, text, data };
}

function expectStatus(result, expected, label) {
  assert.equal(result.response.status, expected, label + " status");
}

async function postJson(path, body) {
  return request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function uploadImage(board, group, body, bytes, name) {
  const form = new FormData();
  form.set("board", board);
  form.set("group", group);
  form.set("body", body);
  form.set("request", crypto.randomUUID());
  form.set("file", new Blob([bytes], { type: "image/png" }), name);
  const result = await request("/api/upload", { method: "PUT", body: form });
  expectStatus(result, 200, "image upload");
  assert.equal(result.data?.ok, true, "image upload response");
  return String(result.data.id);
}

async function uploadVideo(board, group, body, bytes, name) {
  const requestId = crypto.randomUUID();
  const session = await postJson("/api/upload/session", {
    board,
    group,
    body,
    request: requestId,
    type: "video/mp4",
    size: bytes.byteLength,
    name,
  });
  expectStatus(session, 200, "video upload session");
  assert.equal(session.data?.status, "uploading");
  const parts = Number(session.data.parts);
  assert.equal(parts, 1, "small E2E video should use one multipart part");
  const id = String(session.data.id);
  const part = await request("/api/upload/part?id=" + encodeURIComponent(id) + "&part=1", {
    method: "PUT",
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(bytes.byteLength),
    },
    body: bytes,
  });
  expectStatus(part, 200, "video upload part");
  const complete = await postJson("/api/upload/complete", { id });
  expectStatus(complete, 200, "video upload complete");
  assert.equal(complete.data?.status, "completed");
  return String(complete.data.id);
}

async function bestEffortCleanup() {
  if (cleanupCompleted || !cleanupBoardId || !cleanupGroup) return;
  try {
    const listed = await request("/api/board?board=" + encodeURIComponent(cleanupBoardId));
    const candidate = (listed.data?.posts || []).find((post) => post.mediaGroup === cleanupGroup);
    if (candidate?.id) {
      await postJson("/api/board", {
        action: "moderate",
        operation: "delete",
        target: String(candidate.id),
      });
    }
  } catch {}
}

async function main() {
  const locked = await request("/");
  expectStatus(locked, 404, "unauthenticated root");
  assert.equal(locked.response.headers.get("location"), null);

  const genericLogin = await request("/__private/login");
  expectStatus(genericLogin, 404, "generic private login route");

  const login = await request(entryPath);
  expectStatus(login, 200, "private owner entry");
  assert.match(login.response.headers.get("set-cookie") || "", /__Host-lr_private_entry=/);
  assert.match(login.text, /__private\/activate/);

  const wrong = await request("/__private/activate", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "access_token=wrong",
  });
  expectStatus(wrong, 401, "wrong private access");

  const activated = await request("/__private/activate", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ access_token: accessToken }),
  });
  expectStatus(activated, 303, "private activation");
  assert.match(activated.response.headers.get("set-cookie") || "", /__Host-lr_private_preview=/);

  const root = await request("/");
  expectStatus(root, 200, "authenticated root");
  const boardPage = await request("/boards");
  expectStatus(boardPage, 200, "authenticated board page");
  assert.match(boardPage.text, /掲示板|Community|New character board/);

  const initial = await request("/api/board");
  expectStatus(initial, 200, "initial board API");
  assert.ok(initial.data && Array.isArray(initial.data.boards), "board list");
  assert.ok(initial.data.boards.length > 0, "at least one confirmed board");
  const board = initial.data.boards[0];
  const boardId = String(board.id);
  const ownerId = String(initial.data.me?.id || "");
  assert.match(ownerId, /^[a-f0-9-]{36}$/, "persisted Owner user id");
  const initialComments = Number(initial.data.stats?.comments || 0);
  const initialVideos = Number(initial.data.stats?.videos || 0);
  if (process.env.PRIVATE_PREVIEW_E2E_MODE === "discover") {
    await request("/__private/logout", { method: "POST" });
    console.log(JSON.stringify({ ok: true, ownerId }));
    return;
  }
  const group = process.env.PRIVATE_PREVIEW_E2E_GROUP || crypto.randomUUID();
  cleanupBoardId = boardId;
  cleanupGroup = group;
  const body = "private E2E mixed media verification";

  const png = Uint8Array.from(Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ));
  const video = new Uint8Array(64);
  new DataView(video.buffer).setUint32(0, 24);
  video.set(Buffer.from("ftyp"), 4);
  video.set(Buffer.from("isom"), 8);
  video.set(Buffer.from("isomiso2"), 12);

  const mediaIds = [];
  mediaIds.push(await uploadImage(boardId, group, body, png, "private-a.png"));
  mediaIds.push(await uploadImage(boardId, group, body, png, "private-b.png"));
  mediaIds.push(await uploadVideo(boardId, group, body, video, "private-a.mp4"));
  mediaIds.push(await uploadVideo(boardId, group, body, video, "private-b.mp4"));

  const listed = await request("/api/board?board=" + encodeURIComponent(boardId));
  expectStatus(listed, 200, "mixed media listing");
  const grouped = (listed.data.posts || []).filter((post) => post.mediaGroup === group);
  assert.equal(grouped.length, 1, "one logical post card for four attachments");
  assert.equal((grouped[0].mediaItems || []).length, 4, "all attachments in one card");
  assert.equal(Number(listed.data.stats.comments), initialComments + 1, "logical comment count");
  assert.equal(Number(listed.data.stats.todayComments), Number(initial.data.stats.todayComments || 0) + 1, "logical today count");
  assert.equal(Number(listed.data.stats.videos), initialVideos + 2, "video count");
  assert.deepEqual(
    new Set((grouped[0].mediaItems || []).map((item) => item.mediaGroup)),
    new Set([group]),
    "media group scope",
  );

  const detail = await request("/api/board?board=" + encodeURIComponent(boardId) + "&group=" + encodeURIComponent(group));
  expectStatus(detail, 200, "group detail");
  assert.equal((detail.data.mediaItems || []).length, 4, "group detail attachments");

  const anchor = String(grouped[0].id);
  expectStatus(await postJson("/api/board", { action: "like", post: anchor, liked: true }), 200, "like");
  expectStatus(await postJson("/api/board", { action: "helpful", post: anchor, selected: true }), 200, "helpful");
  const reply = await postJson("/api/board", {
    action: "post",
    board: boardId,
    parent: anchor,
    body: "private E2E reply",
    request: crypto.randomUUID(),
  });
  expectStatus(reply, 200, "reply");
  const replies = await request("/api/board?replies=" + encodeURIComponent(anchor));
  expectStatus(replies, 200, "replies");
  assert.ok((replies.data.posts || []).some((post) => post.body === "private E2E reply"), "reply remains one level");

  const deleted = await postJson("/api/board", { action: "moderate", operation: "delete", target: anchor });
  expectStatus(deleted, 200, "group delete");
  const afterDelete = await request("/api/board?board=" + encodeURIComponent(boardId));
  expectStatus(afterDelete, 200, "post-delete listing");
  assert.equal((afterDelete.data.posts || []).some((post) => post.mediaGroup === group), false, "deleted group hidden");
  assert.equal(Number(afterDelete.data.stats.comments), initialComments, "comment count restored");
  assert.equal(Number(afterDelete.data.stats.videos), initialVideos, "video count restored");
  expectStatus(await request("/api/board?replies=" + encodeURIComponent(anchor)), 404, "deleted replies hidden");
  cleanupCompleted = true;

  const logout = await request("/__private/logout", { method: "POST" });
  expectStatus(logout, 303, "private logout");
  const relocked = await request("/");
  expectStatus(relocked, 404, "logout relocks preview");

  console.log(JSON.stringify({
    ok: true,
    ownerId,
    group,
    mediaCount: mediaIds.length,
    logicalComments: Number(listed.data.stats.comments) - initialComments,
    logicalVideos: Number(listed.data.stats.videos) - initialVideos,
  }));
}

main().catch(async (error) => {
  await bestEffortCleanup();
  console.error(error instanceof Error ? error.message : "private_preview_e2e_failed");
  process.exitCode = 1;
});
