// tests/panel-html.js
// Guards the panel's HTML against two bugs that have broken its layout before:
//   - a stray </div> closing .frame early (everything spills into one row)
//   - a missing <meta charset> (emoji and dashes render as "ðŸŽ¬", "â€“")
// Run from cinemate-extension/:  node tests/panel-html.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

for (const file of ["discussion-panel.html", "options.html"]) {
  const html = fs.readFileSync(path.join(__dirname, "..", file), "utf8");

  assert.ok(/<meta\s+charset=["']?utf-8["']?\s*\/?>/i.test(html), `${file}: missing <meta charset="UTF-8">`);

  // Walk the <div>s: none may close without an opener, and none may stay open.
  const body = html.slice(html.indexOf("<body"), html.indexOf("<script"));
  const stack = [];
  for (const match of body.matchAll(/<div\b([^>]*)>|<\/div>/g)) {
    const line = html.slice(0, html.indexOf(body) + match.index).split("\n").length;
    if (match[0] === "</div>") {
      assert.ok(stack.length > 0, `${file}:${line}: extra </div>`);
      stack.pop();
    } else {
      stack.push(line);
    }
  }
  assert.deepStrictEqual(stack, [], `${file}: <div> opened on line(s) ${stack.join(", ")} never closed`);

  // In the panel, every section must sit inside .frame, so .frame's </div>
  // has to be the last one before the scripts.
  if (file === "discussion-panel.html") {
    const frameStart = body.indexOf('<div class="frame">');
    assert.ok(frameStart >= 0, "discussion-panel.html: no .frame");

    let depth = 0;
    let closedAt = -1;
    for (const match of body.slice(frameStart).matchAll(/<div\b[^>]*>|<\/div>/g)) {
      depth += match[0] === "</div>" ? -1 : 1;
      if (depth === 0) {
        closedAt = frameStart + match.index;
        break;
      }
    }

    const after = body.slice(closedAt + "</div>".length).replace(/<\/?body>|\s/g, "");
    assert.strictEqual(after, "", "discussion-panel.html: content after .frame closes – a stray </div>?");
  }
}

console.log("✅ Panel HTML: charset set, <div>s balanced, everything inside .frame");
