// Servidor SMTP de PRUEBA (solo local). Acepta todo el correo sin entregarlo y anota
// destinatario y asunto en un registro JSON-lines, para comprobar qué envió el endpoint.
// Uso: node sink.mjs <archivo_registro>   (escucha en 127.0.0.1:2525)

import { SMTPServer } from 'smtp-server';
import { appendFileSync } from 'node:fs';

const logFile = process.argv[2];
if (!logFile) {
  console.error('Indica un archivo de registro');
  process.exit(1);
}

const server = new SMTPServer({
  authOptional: true,
  disabledCommands: ['STARTTLS'],
  onData(stream, session, callback) {
    let raw = '';
    stream.on('data', (chunk) => {
      raw += chunk.toString('utf8');
    });
    stream.on('end', () => {
      const subject = (raw.match(/^Subject: (.*)$/m) || [])[1] || '';
      const replyTo = (raw.match(/^Reply-To: (.*)$/m) || [])[1] || '';
      appendFileSync(
        logFile,
        JSON.stringify({ from: session.envelope.mailFrom?.address, to: session.envelope.rcptTo.map((r) => r.address), subject, replyTo, imagenIncrustada: /Content-ID: <gracias-chispabox>/.test(raw), html: raw.includes("text/html") }) + '\n',
      );
      callback();
    });
  },
});

const puerto = Number(process.env.SINK_PORT || 2525);
server.listen(puerto, '127.0.0.1', () => console.log(`sink SMTP en 127.0.0.1:${puerto}`));
