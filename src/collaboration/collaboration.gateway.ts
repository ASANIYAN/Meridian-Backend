import * as schema from '../database/schema';
import { Inject, Logger, OnApplicationShutdown } from '@nestjs/common';
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
import { randomUUID } from 'node:crypto';
import { IncomingMessage } from 'node:http';
import WebSocket from 'ws';
import { RedisService } from '../redis/redis.service';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { MembershipsService } from '../memberships/memberships.service';
import { SnapshotsService } from '../snapshots/snapshots.service';
import { OperationsService } from '../operations/operations.service';
import { OutboxService } from '../outbox/outbox.service';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_CONNECTION } from '../database/database-connection';
import { YjsService } from '../yjs/yjs.service';
import { InjectQueue } from '@nestjs/bullmq';
import { SNAPSHOT_JOB, SNAPSHOT_QUEUE } from '../snapshots/snapshot.queue';
import { Queue } from 'bullmq';

const port = Number(process.env.WS_PORT) || 8001;

type AuthenticatedSocket = WebSocket & {
  user: {
    userId: string;
    email: string;
    role?: 'author' | 'editor' | 'viewer';
    documentId?: string;
  };
  // Settled by handleConnection once client.user is safe to read. Message handlers
  // await this first, since NestJS binds the message listener before handleConnection's
  // async auth work finishes.
  authReady: Promise<void>;
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
  // Max operations allowed to accumulate since the last snapshot before a worker compacts them.
  private readonly SNAPSHOT_THRESHOLD = 50;
  // Unique per-process id, prefixed onto every Redis-published frame so a process can
  // recognize and skip its own broadcasts coming back through its own subscription.
  private readonly instanceId = Buffer.from(
    randomUUID().replace(/-/g, ''),
    'hex',
  );
  private healthCheckInterval: NodeJS.Timeout | undefined;
  // Tracks which documents this process has already subscribed to on Redis, so a busy
  // document with many local clients only gets one Redis subscription, not one per client.
  private readonly subscribedChannels = new Set<string>();
  private roomsMap: RoomsMap = new Map();

  constructor(
    @InjectQueue(SNAPSHOT_QUEUE)
    private readonly snapshotQueue: Queue,
    @Inject(DATABASE_CONNECTION)
    private readonly database: NodePgDatabase<typeof schema>,
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
    private readonly membershipService: MembershipsService,
    private readonly snapshotsService: SnapshotsService,
    private readonly operationsService: OperationsService,
    private readonly outboxService: OutboxService,
    private readonly yjsService: YjsService,
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
    const authClient = client as AuthenticatedSocket;
    // resolve/reject only exist inside this executor, so settleAuth carries them out
    // to be called later, after the awaits below decide the outcome.
    let settleAuth: (err?: unknown) => void = () => {};
    authClient.authReady = new Promise<void>((resolve, reject) => {
      settleAuth = (err) =>
        err
          ? reject(
              err instanceof Error ? err : new Error('Authentication failed'),
            )
          : resolve();
    });
    // Prevents an "unhandled rejection" warning if the client disconnects before any
    // message handler ever awaits authReady.
    authClient.authReady.catch(() => {});

    try {
      const token = this.extractToken(request);
      const payload = await this.verifyJwt(token);

      const isBlacklisted = await this.redisService.isTokenBlacklisted(
        payload.jti,
      );

      if (isBlacklisted) {
        client.close(4001, 'Token has been revoked');
        settleAuth(new Error('Token has been revoked'));
        return;
      }

      authClient.user = {
        userId: payload.userId,
        email: payload.email,
      };
      // Unblocks any handleJoin/handleUpdate call that arrived early and is waiting
      // on authReady — client.user is now safe for them to read.
      settleAuth();

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
      settleAuth(error);
      return;
    }
  }

  @SubscribeMessage('join')
  async handleJoin(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { document_id: string },
  ): Promise<void> {
    // Guards against this handler running before handleConnection has set
    // client.user — see authReady's definition on AuthenticatedSocket.
    try {
      await client.authReady;
    } catch {
      return;
    }

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

    if (!this.subscribedChannels.has(documentId)) {
      // Only mark this document as subscribed once both channels succeed. If one throws
      // partway through, a later join retries cleanly instead of risking a duplicate
      // listener on whichever channel already subscribed.
      try {
        // Relays Yjs updates published by other instances into this instance's local room.
        await this.redisService.subscribe(
          `doc:${documentId}`,
          (frame: Buffer) => {
            // Skip frames this same instance published — they were already sent to the
            // local room directly, so re-sending here would deliver them twice.
            if (frame.subarray(0, 16).equals(this.instanceId)) return;

            const update = frame.subarray(16);
            const room = this.roomsMap.get(documentId);
            room?.forEach((socket) => {
              if (socket.readyState === WebSocket.OPEN) {
                socket.send(update);
              }
            });
          },
        );

        // Same relay pattern as above, for presence (online/offline) events instead of edits.
        await this.redisService.subscribe(
          `presence:${documentId}`,
          (frame: Buffer) => {
            if (frame.subarray(0, 16).equals(this.instanceId)) return;

            const payload = frame.subarray(16);
            const room = this.roomsMap.get(documentId);
            room?.forEach((socket) => {
              if (socket.readyState === WebSocket.OPEN) {
                socket.send(payload);
              }
            });
          },
        );

        this.subscribedChannels.add(documentId);
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`Failed to subscribe to document channels: ${msg}`);
        client.close(1011, 'Failed to initialize document channel');
        return;
      }
    }

    const snapshot = await this.snapshotsService.getLatestSnapshot(documentId);
    const afterSequence = snapshot?.operationSequence ?? 0;

    const operations = await this.operationsService.getOperationsSinceSequence(
      documentId,
      afterSequence,
    );

    client.send(
      JSON.stringify({
        event: 'initial_state',
        data: {
          snapshot: snapshot ? snapshot.contentBlob.toString('base64') : null,
          delta: operations,
        },
      }),
    );
  }

  @SubscribeMessage('update')
  async handleUpdate(
    client: AuthenticatedSocket,
    data: Buffer | number[],
  ): Promise<void> {
    // Same guard as handleJoin: wait for handleConnection to finish before reading
    // client.user.
    try {
      await client.authReady;
    } catch {
      // handleConnection already closed the socket; nothing to do here.
      return;
    }

    if (client.user.role === 'viewer') {
      return;
    }

    const documentId = client.user.documentId;
    if (!documentId) {
      return;
    }

    const update = Buffer.isBuffer(data) ? data : Buffer.from(data);

    try {
      const classified = this.yjsService.classifyUpdate(update);

      const opResult = await this.database.transaction(async (tx) => {
        // Must be first — the lock must cover the MAX read, clock computation,
        // and INSERT as one atomic unit to guarantee Lamport monotonicity.
        await this.operationsService.acquireDocumentWriteLock(tx, documentId);

        const localClock = await this.operationsService.getMaxClockValue(
          tx,
          documentId,
        );
        const received = BigInt(classified.receivedClock);
        const clockValue = (localClock > received ? localClock : received) + 1n;

        const result = await this.operationsService.insertOperation(tx, {
          documentId,
          userId: client.user.userId,
          yjsUpdate: update,
          type: classified.type,
          payload: classified.payload,
          clockValue,
        });

        await this.outboxService.insertOutboxEntry(tx, {
          documentId,
          operationId: result.id,
          payload: update,
        });

        return result;
      });

      // Prefixing with instanceId lets this same instance's `doc:` subscriber (above)
      // recognize and ignore this broadcast when Redis echoes it back.
      await this.redisService.publish(
        `doc:${documentId}`,
        Buffer.concat([this.instanceId, update]),
      );

      const room = this.roomsMap.get(documentId);
      room?.forEach((socket) => {
        if (socket !== client) {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(update);
          }
        }
      });

      client.send(
        JSON.stringify({
          event: 'ack',
          data: {
            operation_sequence: opResult.operationSequence,
            status: 'ok',
          },
        }),
      );
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown Error';
      this.logger.error(`Error: ${errMsg}`);
      client.send(JSON.stringify({ event: 'ack', data: { status: 'error' } }));
    }
  }

  private async broadcastPresence(
    documentId: string,
    room: Set<AuthenticatedSocket> | undefined,
    userId: string,
    status: 'offline',
  ) {
    const payload = Buffer.from(
      JSON.stringify({ type: 'presence', userId, status }),
    );

    // Send to clients on this instance directly first — no need to wait on a Redis
    // round trip for the common case where they're all on the same process.
    room?.forEach((socket) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(payload);
      }
    });

    // Then publish for other instances' rooms, since `room` here is only ever local.
    await this.redisService.publish(
      `presence:${documentId}`,
      Buffer.concat([this.instanceId, payload]),
    );
  }

  async handleDisconnect(client: AuthenticatedSocket) {
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
      // Delete before broadcasting so the loop only reaches clients still in the room.
      room.delete(client);
      await this.broadcastPresence(
        documentId,
        room,
        client.user.userId,
        'offline',
      );

      if (room.size === 0) {
        this.roomsMap.delete(documentId);
        if (this.subscribedChannels.has(documentId)) {
          await this.redisService.unsubscribe(`doc:${documentId}`);
          await this.redisService.unsubscribe(`presence:${documentId}`);
          this.subscribedChannels.delete(documentId);
        }
      }
    }

    // Isolated from the presence broadcast above: a DB/Redis hiccup here should only
    // skip this bookkeeping, never break disconnect cleanup for other connected clients.
    try {
      const latestSnapshot =
        await this.snapshotsService.getLatestSnapshot(documentId);
      const afterSeq = latestSnapshot?.operationSequence ?? 0;
      const opCount = await this.operationsService.countOperationsSinceSequence(
        documentId,
        afterSeq,
      );

      if (opCount >= this.SNAPSHOT_THRESHOLD) {
        // Multiple clients can disconnect from the same document within the same
        // window and all see the same stale op count — this lock lets only the first
        // one through. It self-expires rather than being released explicitly, since
        // there's no completion signal back from the snapshot worker yet.
        const acquired = await this.redisService.tryAcquireLock(
          `snapshot:lock:${documentId}`,
          30,
        );
        if (acquired) {
          await this.snapshotQueue.add(
            SNAPSHOT_JOB,
            { documentId },
            { jobId: `snapshot:${documentId}` },
          );
        }
      }
    } catch (error) {
      const err = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(err);
    }

    this.logger.log('Client disconnected');
  }

  onApplicationShutdown() {
    this.logger.log('WebSocket server closed');
    clearInterval(this.healthCheckInterval);
  }
}
