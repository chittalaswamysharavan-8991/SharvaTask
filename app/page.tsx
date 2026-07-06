export default function HomePage() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 760, margin: '48px auto', padding: 24 }}>
      <h1>SharvaTask MCP V2.2</h1>
      <p>Persistent list and task history MCP for SharvaOS, now with a polished milky-white ChatGPT interactive widget.</p>
      <ul>
        <li>Health: <code>/api/health</code></li>
        <li>MCP: <code>/api/mcp</code></li>
        <li>MCP alias: <code>/mcp</code></li>
        <li>Widget resource: <code>ui://widget/sharvatask.html</code></li>
      </ul>
      <p>Connector URL: <code>https://your-project.vercel.app/api/mcp</code></p>
    </main>
  );
}
