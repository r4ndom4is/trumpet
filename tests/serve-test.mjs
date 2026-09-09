import { serve as serveApp } from "../scripts/serve.mjs";

// Tests opt into stubs/emulators explicitly; real project config must never leak
// into gameplay fixtures, including those served through a service worker.
export function serve({ transform = (_, content) => content, ...options } = {}) {
  return serveApp({ ...options, transform(file, content) {
    const isolated = file === "index.html" ? localOnlyConfig(content) : content;
    return transform(file, isolated);
  } });
}

export function localOnlyConfig(content) {
  return content.toString().replace(
    /\/\/ BEGIN GENERATED FIREBASE CONFIG[\s\S]*?\/\/ END GENERATED FIREBASE CONFIG/,
    "// BEGIN GENERATED FIREBASE CONFIG\nwindow.TRUMPET_FIREBASE = { enabled: false };\n// END GENERATED FIREBASE CONFIG"
  );
}
