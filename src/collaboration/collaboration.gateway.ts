import { Logger, OnApplicationShutdown } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import WebSocket from 'ws';

const port = Number(process.env.WS_PORT) || 8001;

@WebSocketGateway({ port })
export class CollaborationGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnApplicationShutdown
{
  @WebSocketServer()
  server: WebSocket.Server | undefined;

  private readonly logger = new Logger(CollaborationGateway.name);
  private healthCheckInterval: NodeJS.Timeout | undefined;

  afterInit(_server: WebSocket.Server) {
    this.logger.log('WebSocket server initialized');
    this.healthCheckInterval = setInterval(() => {
      this.logger.log(
        `Active WebSocket connections: ${this.server?.clients.size}`,
      );
    }, 30_000);
  }

  handleConnection(client: WebSocket) {
    this.logger.log('Client connected');
    client.on('message', (data: WebSocket.RawData) => {
      if (Buffer.isBuffer(data)) {
        this.logger.debug(`Received binary frame: ${data.byteLength} bytes`);
      }
    });
  }

  handleDisconnect(_client: WebSocket) {
    this.logger.log('Client disconnected');
  }

  onApplicationShutdown() {
    this.logger.log('WebSocket server closed');
    clearInterval(this.healthCheckInterval);
  }
}
