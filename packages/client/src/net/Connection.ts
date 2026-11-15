import { PROTOCOL_VERSION, WS_PATH, decode, encode, type C2S, type S2C } from '@2dpw/shared';

export type ConnState = 'connecting' | 'connected' | 'disconnected';

/** Thin WebSocket wrapper with auto-reconnect and RTT measurement. */
export class Connection {
  private ws: WebSocket | null = null;
  private pingTimer: number | undefined;
  state: ConnState = 'disconnected';
  rtt = 0;
  sessionId = '';

  constructor(
    private readonly onState: (s: ConnState) => void,
    private readonly onMessage: (m: S2C) => void = () => {},
  ) {}

  connect(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.setState('connecting');
    const ws = new WebSocket(`${proto}://${location.host}${WS_PATH}`);
    this.ws = ws;
    ws.onopen = () => this.send({ t: 'hello', version: PROTOCOL_VERSION });
    ws.onmessage = (ev) => {
      const msg = decode<S2C>(String(ev.data));
      if (!msg) return;
      if (msg.t === 'welcome') {
        this.sessionId = msg.sessionId;
        this.setState('connected');
        this.pingTimer = window.setInterval(
          () => this.send({ t: 'ping', at: performance.now() }),
          2000,
        );
      } else if (msg.t === 'pong') {
        this.rtt = Math.round(performance.now() - msg.at);
      }
      this.onMessage(msg);
    };
    ws.onclose = () => {
      window.clearInterval(this.pingTimer);
      this.setState('disconnected');
      window.setTimeout(() => this.connect(), 2000);
    };
  }

  send(msg: C2S): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encode(msg));
  }

  private setState(s: ConnState): void {
    this.state = s;
    this.onState(s);
  }
}
