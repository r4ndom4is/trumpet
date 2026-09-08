import { serve } from "./serve.mjs";

const config = {
  enabled: true, apiKey: "demo-key", authDomain: "demo-trumpet-flight.firebaseapp.com",
  projectId: "demo-trumpet-flight", appId: "demo-trumpet-flight", emulators: true
};
const server = serve({ transform(file, content) {
  if (file !== "index.html") return content;
  const begin = "// BEGIN GENERATED FIREBASE CONFIG", end = "// END GENERATED FIREBASE CONFIG";
  const html = content.toString();
  if (html.split(begin).length !== 2 || html.split(end).length !== 2) throw new Error("Missing Firebase config markers.");
  return html.slice(0, html.indexOf(begin) + begin.length) +
    "\nwindow.TRUMPET_FIREBASE = " + JSON.stringify(config) + ";\n" + html.slice(html.indexOf(end));
} });
const port = Number(process.env.PORT || 4184);
server.listen(port, "127.0.0.1", () => {
  console.log(`Local Firebase score preview: http://localhost:${port}/trumpet/?entry=direct`);
  console.log("Uses only demo-trumpet-flight on Auth :9099 and Firestore :8080. Run npm run firebase:emulators first.");
});
