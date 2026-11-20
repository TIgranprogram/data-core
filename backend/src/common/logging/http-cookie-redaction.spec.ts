import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { Writable } from 'node:stream';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import pinoHttp, { type Options } from 'pino-http';

it('HTTP-лог удаляет cookie и секрет моста, оставляя обычные заголовки', async () => {
  const config = jest.spyOn(ConfigModule, 'forRoot').mockResolvedValue({ module: ConfigModule });
  const logger = jest.spyOn(LoggerModule, 'forRootAsync');
  try {
    await import('../../app.module');
    const factory = logger.mock.calls[0][0].useFactory!;
    const { pinoHttp: options } = await factory();
    let output = '';
    const dest = new Writable({ write(chunk, _encoding, done) { output += chunk.toString(); done(); } });
    const httpLogger = pinoHttp({ ...(options as Options), level: 'info', transport: undefined }, dest);

    const request = new IncomingMessage(new Socket());
    request.method = 'GET';
    request.url = '/logging-probe';
    request.headers = { cookie: 'probe=request-fixture', 'x-probe': 'visible-request', 'x-switch-secret': 'switch-secret-fixture' };
    const response = new ServerResponse(request);
    const cookies = ['probe=response-fixture; HttpOnly', 'second=second-fixture; Secure'];
    response.setHeader('Set-Cookie', cookies);
    response.setHeader('X-Probe', 'visible-response');
    httpLogger(request, response);
    response.emit('finish');

    expect(output.includes('request-fixture')).toBe(false);
    expect(output.includes('response-fixture')).toBe(false);
    expect(output.includes('second-fixture')).toBe(false);
    expect(output.includes('x-switch-secret')).toBe(false);
    expect(output.includes('switch-secret-fixture')).toBe(false);
    expect(output.includes('visible-request')).toBe(true);
    expect(output.includes('visible-response')).toBe(true);
    expect(response.getHeader('Set-Cookie') === cookies).toBe(true);
  } finally {
    logger.mockRestore();
    config.mockRestore();
  }
});
