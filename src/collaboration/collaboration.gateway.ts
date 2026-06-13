import { Logger, OnApplicationShutdown } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { IncomingMessage } from 'node:http';
import WebSocket from 'ws';
import { RedisService } from '../redis/redis.service';
import { JwtPayload } from '../auth/strategies/jwt.strategy';

const port = Number(process.env.WS_PORT) || 8001;

type AuthenticatedSocket = WebSocket & {
  user: { userId: string; email: string };
};

@WebSocketGateway(port)
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

  constructor(
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
  ) {}

  afterInit(_server: WebSocket.Server) {
    this.logger.log('WebSocket server initialized');
    this.healthCheckInterval = setInterval(() => {
      this.logger.log(
        `Active WebSocket connections: ${this.server?.clients.size}`,
      );
    }, 30_000);
  }

  private extractToken(request: IncomingMessage): string | null {
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }

    const url = new URL(request.url!, `http://localhost`);
    const tokenParam = url.searchParams.get('token');
    if (tokenParam) {
      return tokenParam;
    }

    return null;
  }

  private async verifyJwt(token: string | null): Promise<JwtPayload> {
    if (!token) {
      throw new Error('Invalid or empty token');
    }
    try {
      const result = await this.jwtService.verifyAsync<JwtPayload>(token);

      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error: ${msg}`);
      throw new Error('Invalid or empty token');
    }
  }

  async handleConnection(client: WebSocket, request: IncomingMessage) {
    try {
      const token = this.extractToken(request);
      const payload = await this.verifyJwt(token);

      const isBlacklisted = await this.redisService.isTokenBlacklisted(
        payload.jti,
      );

      if (isBlacklisted) {
        client.close(4001, 'Token has been revoked');
        return;
      }

      (client as AuthenticatedSocket).user = {
        userId: payload.userId,
        email: payload.email,
      };

      this.logger.log('Client connected');
      client.on('message', (data: WebSocket.RawData) => {
        if (Buffer.isBuffer(data)) {
          this.logger.debug(`Received binary frame: ${data.byteLength} bytes`);
        }
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error: ${msg}`);
      client.close(4001, 'Authentication failed');
    }
  }

  handleDisconnect(_client: WebSocket) {
    this.logger.log('Client disconnected');
  }

  onApplicationShutdown() {
    this.logger.log('WebSocket server closed');
    clearInterval(this.healthCheckInterval);
  }
}
