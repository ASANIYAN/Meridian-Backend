import { Logger, OnApplicationShutdown } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { IncomingMessage } from 'node:http';
import WebSocket from 'ws';
import { RedisService } from '../redis/redis.service';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { MembershipsService } from '../memberships/memberships.service';
import { SnapshotsService } from '../snapshots/snapshots.service';
import { OperationsService } from '../operations/operations.service';

const port = Number(process.env.WS_PORT) || 8001;

type AuthenticatedSocket = WebSocket & {
  user: {
    userId: string;
    email: string;
    role?: 'author' | 'editor' | 'viewer';
    documentId?: string;
  };
};

type RoomsMap = Map<string, Set<AuthenticatedSocket>>;

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
  private roomsMap: RoomsMap = new Map();

  constructor(
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
    private readonly membershipService: MembershipsService,
    private readonly snapshotsService: SnapshotsService,
    private readonly operationsService: OperationsService,
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
      return;
    }
  }

  @SubscribeMessage('join')
  async handleJoin(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { document_id: string },
  ): Promise<void> {
    const documentId = data.document_id;
    if (!documentId) {
      client.close(4001, 'No document id found');
      return;
    }

    const membership = await this.membershipService.getUserDocumentMembership(
      documentId,
      client.user.userId,
    );

    if (!membership) {
      client.close(4003, 'Forbidden');
      return;
    }

    client.user.role = membership.role;
    client.user.documentId = documentId;

    if (!this.roomsMap.has(documentId)) {
      this.roomsMap.set(documentId, new Set());
    }
    this.roomsMap.get(documentId)!.add(client);

    const snapshot = await this.snapshotsService.getLatestSnapshot(documentId);

    if (!snapshot) {
      client.send(
        JSON.stringify({
          event: 'initial_state',
          data: { snapshot: null, operations: [] },
        }),
      );
      return;
    }

    const operations = await this.operationsService.getOperationsSinceSequence(
      documentId,
      snapshot.operationSequence,
    );

    client.send(
      JSON.stringify({
        event: 'initial_state',
        data: {
          snapshot: snapshot.contentBlob.toString('base64'),
          operations,
        },
      }),
    );
  }

  handleDisconnect(client: AuthenticatedSocket) {
    if (!client.user) {
      this.logger.log('Unauthenticated client disconnected.');
      return;
    }

    const documentId = client.user.documentId;
    if (!documentId) {
      this.logger.log('Client disconnected before joining a document');
      return;
    }
    const room = this.roomsMap.get(documentId);
    if (room) {
      room.delete(client);
      if (room.size === 0) {
        this.roomsMap.delete(documentId);
      }
    }
    this.logger.log('Client disconnected');
  }

  onApplicationShutdown() {
    this.logger.log('WebSocket server closed');
    clearInterval(this.healthCheckInterval);
  }
}
