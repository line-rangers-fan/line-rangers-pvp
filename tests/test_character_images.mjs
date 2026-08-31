import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = fs.readFileSync(new URL("../docs/assets/app.js", import.meta.url), "utf8");
function element(tag) {
  const listeners = new Map();
  return {
    tag, children: [], attributes: {}, requests: [], hidden: false,
    textContent: "", className: "",
    append(...children) { this.children.push(...children); },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, callback) { listeners.set(name, callback); },
    dispatch(name) { listeners.get(name)?.(); },
    set src(value) { this.requests.push(value); },
    get src() { return this.requests.at(-1); },
  };
}
function harness() {
  let now = 1_000 * 600_000;
  const context = vm.createContext({
    URL, Intl, console, Date: class extends Date { static now() { return now; } },
    document: { querySelector() { return null; }, addEventListener() {}, createElement: element },
    window: {},
  });
  vm.runInContext(source, context);
  return {
    context,
    advance() { now += 600_000; },
    create(character = sample(), options = {}) {
      context.character = character;
      context.options = { className: "character-image", alt: "33位のキャラクター画像", loading: "lazy", ...options };
      const frame = vm.runInContext("createCharacterImage(character, options)", context);
      return { frame, image: frame.children[0], pending: frame.children[1] };
    },
  };
}
function sample(code = "u1630h-sally") {
  return { unit_code: code, name: code,
    image: `https://rangers.lerico.net/res/${code}/${code}-thum.png`,
    occurrence_count: 4, player_count: 4, adoption_rate: 2.0 };
}

test("existing images retain the canonical URL, lazy loading, size and alt text", () => {
  const character = sample("u1556e-af");
  const { frame, image, pending } = harness().create(character);
  assert.match(frame.className, /character-image-frame/);
  assert.deepEqual(image.requests, [character.image]);
  assert.equal(image.loading, "lazy");
  assert.equal(image.width, 64);
  assert.equal(image.height, 64);
  assert.equal(image.alt, "33位のキャラクター画像");
  image.dispatch("load");
  assert.equal(image.hidden, false);
  assert.equal(pending.hidden, true);
  assert.equal(image.requests.length, 1);
});

test("404 or image decode errors trigger exactly one same-unit cache-busting retry", () => {
  for (const code of ["u1630h-sally", "u1631e-sally", "u99999e-future"]) {
    const character = sample(code);
    const before = JSON.stringify(character);
    const { image, pending } = harness().create(character);
    image.dispatch("error");
    assert.equal(image.hidden, true);
    assert.equal(pending.hidden, false);
    assert.equal(pending.textContent, "画像\n準備中");
    assert.equal(pending.attributes.role, "img");
    assert.match(pending.attributes["aria-label"], new RegExp(code));
    assert.equal(image.loading, "eager", "hidden lazy retries must not be deferred");
    assert.equal(image.src, `${character.image}?image_retry=1000`);
    for (let i = 0; i < 5; i++) image.dispatch("error");
    assert.equal(image.requests.length, 2, "persistent failures must not loop");
    assert.equal(image.hidden, true, "never leave the browser's broken-image icon visible");
    assert.equal(JSON.stringify(character), before, "image failures must not mutate counts/data");
  }
});

test("a successful retry replaces the pending label with the actual character image", () => {
  const { image, pending } = harness().create();
  image.dispatch("error");
  image.dispatch("load");
  assert.equal(image.hidden, false);
  assert.equal(pending.hidden, true);
  assert.equal(image.requests.length, 2);
});

test("re-renders share retry cache keys, but later refreshes retry after source publication", () => {
  const app = harness();
  const first = app.create();
  first.image.dispatch("error");
  first.image.dispatch("error");
  const sameWindow = app.create();
  sameWindow.image.dispatch("error");
  assert.equal(sameWindow.image.src, first.image.src);
  app.advance();
  const later = app.create();
  later.image.dispatch("error");
  assert.notEqual(later.image.src, first.image.src);
  assert.match(later.image.src, /image_retry=1001$/);
  later.image.dispatch("load");
  assert.equal(later.pending.hidden, true);
  assert.equal(later.image.hidden, false);
});

test("the equipment dialog shares image recovery without changing its sizing class", () => {
  const { frame, image, pending } = harness().create(sample(), {
    className: "equipment-character-image", alt: "New character", loading: "eager",
  });
  assert.match(frame.className, /equipment-character-image/);
  assert.equal(image.alt, "New character");
  image.dispatch("error");
  image.dispatch("error");
  assert.equal(pending.hidden, false);
  assert.match(source, /characterButton\.appendChild\(createCharacterImage\(char,/);
  assert.match(source, /const characterImage = createCharacterImage\(character,/);
});

test("untrusted URLs, mismatched units and query injection are never requested", () => {
  const valid = sample();
  const invalid = [
    { ...valid, image: "https://example.com/character.png" },
    { ...valid, image: valid.image.replace("https:", "http:") },
    { ...valid, image: valid.image.replace("https://", "https://example@") },
    { ...valid, image: valid.image + "?redirect=https://example.com" },
    { ...valid, image: valid.image + "#extra" },
    { ...valid, image: "javascript:alert(1)" },
    { ...valid, image: "data:image/png;base64,invalid" },
    { ...valid, image: sample("u1556e-af").image },
    { ...valid, unit_code: "../../invalid" },
    { ...valid, image: "" },
  ];
  for (const character of invalid) {
    const { image, pending } = harness().create(character);
    image.dispatch("error");
    assert.equal(image.requests.length, 0);
    assert.equal(image.hidden, true);
    assert.equal(pending.hidden, false);
  }
});

test("all supported languages have nonempty fallback text", () => {
  const app = harness();
  for (const language of ["ja", "en", "zh", "th", "id", "vi", "ko"]) {
    app.context.language = language;
    vm.runInContext("state.language = language", app.context);
    const { pending } = app.create();
    assert.ok(pending.textContent.trim());
  }
});
