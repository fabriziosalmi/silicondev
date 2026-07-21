import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'SiliconDev',
  description: 'Local LLM development environment for Apple Silicon',
  base: '/silicondev/',

  head: [
    // Tutto first-party. 'unsafe-inline' serve perche' VitePress emette
    // uno script inline per il tema e stili inline.
    [
      'meta',
      {
        'http-equiv': 'Content-Security-Policy',
        content:
          "default-src 'self'; script-src 'self' 'unsafe-inline'; " +
          "style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
          "font-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'",
      },
    ],
    ['link', { rel: 'icon', href: '/silicondev/favicon.ico' }],
  ],

  themeConfig: {
    logo: '/logo.png',

    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Features', link: '/features/chat' },
      { text: 'API', link: '/api/overview' },
      { text: 'Development', link: '/development/setup' },
      {
        text: 'v0.14.0',
        items: [
          { text: 'Changelog', link: '/changelog' },
          { text: 'GitHub', link: 'https://github.com/fabriziosalmi/silicondev' },
        ],
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Architecture', link: '/guide/architecture' },
            { text: 'Configuration', link: '/guide/configuration' },
          ],
        },
      ],
      '/features/': [
        {
          text: 'Local Server',
          items: [
            { text: 'Models', link: '/features/models' },
            { text: 'Chat', link: '/features/chat' },
            { text: 'Agent Terminal', link: '/features/terminal' },
            { text: 'Code Workspace', link: '/features/code-workspace' },
            { text: 'Notes', link: '/features/notes' },
          ],
        },
        {
          text: 'Advanced Tools',
          items: [
            { text: 'Data Preparation', link: '/features/data-preparation' },
            { text: 'Fine-Tuning', link: '/features/fine-tuning' },
            { text: 'Model Export', link: '/features/model-export' },
            { text: 'Evaluations', link: '/features/evaluations' },
            { text: 'RAG Knowledge', link: '/features/rag' },
            { text: 'MCP Servers', link: '/features/mcp' },
            { text: 'Pipelines & Jobs', link: '/features/agents' },
            { text: 'Deployment', link: '/features/deployment' },
          ],
        },
        {
          text: 'App',
          items: [
            { text: 'Settings', link: '/features/settings' },
          ],
        },
      ],
      '/api/': [
        {
          text: 'API Reference',
          items: [
            { text: 'Overview', link: '/api/overview' },
            { text: 'Engine / Models', link: '/api/engine' },
            { text: 'Chat', link: '/api/chat' },
            { text: 'RAG', link: '/api/rag' },
            { text: 'Conversations', link: '/api/conversations' },
            { text: 'Notes', link: '/api/notes' },
            { text: 'Agents', link: '/api/agents' },
            { text: 'Terminal', link: '/api/terminal' },
            { text: 'Data Preparation', link: '/api/preparation' },
            { text: 'MCP', link: '/api/mcp' },
            { text: 'Deployment', link: '/api/deployment' },
            { text: 'Sandbox', link: '/api/sandbox' },
            { text: 'Search', link: '/api/search' },
            { text: 'Indexer', link: '/api/indexer' },
            { text: 'Monitor', link: '/api/monitor' },
            { text: 'Preview', link: '/api/preview' },
            { text: 'Codebase', link: '/api/codebase' },
          ],
        },
      ],
      '/development/': [
        {
          text: 'Development',
          items: [
            { text: 'Setup', link: '/development/setup' },
            { text: 'Project Structure', link: '/development/project-structure' },
            { text: 'Contributing', link: '/development/contributing' },
            { text: 'Releasing', link: '/development/releasing' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/fabriziosalmi/silicondev' },
    ],

    search: {
      provider: 'local',
    },

    footer: {
      message: 'Released under the MIT License.' + ' · <a href="https://fabriziosalmi.github.io/privacy">Privacy &amp; legal</a>',
      copyright: 'Based on Silicon-Studio by Riley Cleavenger.',
    },
  },
})
