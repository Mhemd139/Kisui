import { createMcpHandler } from 'mcp-handler';
import { loadCorpus } from '../../src/corpus';
import { registerTools, SERVER_INSTRUCTIONS } from '../../src/server';

const handler = createMcpHandler((server) => registerTools(server, loadCorpus()), {
  serverInfo: { name: 'kisui', version: '0.1.0' },
  instructions: SERVER_INSTRUCTIONS,
});

export { handler as GET, handler as POST };
