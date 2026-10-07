const { createServer } = require('node:net');

const server = createServer();
server.listen(0, '127.0.0.1', () => {
  process.send({ port: server.address().port });
});
process.on('message', (message) => {
  if (message === 'close-port') server.close(() => process.send({ closed: true }));
});
process.on('disconnect', () => process.exit());
