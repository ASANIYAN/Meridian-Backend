import * as schema from '../database/schema';
import { Inject, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { UsersService } from '../users/users.service';
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
  messageCount: number;
  consecutiveViolations: number;
  windowTimer: NodeJS.Timeout | undefined;
  // Set only once a presenceJoin increment has actually been recorded for this socket,
  // so handleDisconnect never decrements a count for a join that failed before counting.
  presenceCounted?: boolean;
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
  private readonly wsConnectionRateLimit: number;
  private readonly wsMessageRateLimit: number;
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
    private readonly usersService: UsersService,
    private readonly snapshotsService: SnapshotsService,
    private readonly operationsService: OperationsService,
    private readonly outboxService: OutboxService,
    private readonly yjsService: YjsService,
    private readonly configService: ConfigService,
  ) {
    this.wsConnectionRateLimit = this.configService.getOrThrow<number>(
      'WS_CONNECTION_RATE_LIMIT',
    );
    this.wsMessageRateLimit = this.configService.getOrThrow<number>(
      'WS_MESSAGE_RATE_LIMIT',
    );
  }
  afterInit(_server: WebSocket.Server) {
    this.logger.log('WebSocket server initialized');
    this.healthCheckInterval = setInterval(() => {
      this.logger.log(
        `Active WebSocket connections: ${this.server?.clients.size}`,
      );
    }, 30_000);
  }

  private extractIp(request: IncomingMessage): string {
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
    return request.socket.remoteAddress ?? 'unknown';
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
      const ip = this.extractIp(request);
      const [hits] = await this.redisService.throttleIncrement(
        `ws:conn:rate:${ip}`,
        60_000,
      );
      if (hits > this.wsConnectionRateLimit) {
        this.logger.warn(`WS connection rate limit exceeded - ip=${ip}`);
        client.close(4029, 'Connection rate limit exceeded');
        settleAuth(new Error('Connection rate limit exceeded'));
        return;
      }

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

        // Same relay pattern as above, for presence (online/offline) events instead of
        // edits. Decoded to a string so it leaves as a WebSocket text frame: every binary
        // frame the client receives is therefore a Yjs document update and every text
        // frame is JSON, so the provider never has to content-sniff to tell them apart.
        await this.redisService.subscribe(
          `presence:${documentId}`,
          (frame: Buffer) => {
            if (frame.subarray(0, 16).equals(this.instanceId)) return;

            const payload = frame.subarray(16).toString('utf8');
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

    client.messageCount = 0;
    client.consecutiveViolations = 0;
    client.windowTimer = setInterval(() => {
      const wasViolation = client.messageCount > this.wsMessageRateLimit;
      client.messageCount = 0;
      if (wasViolation) {
        client.consecutiveViolations++;
        if (client.consecutiveViolations >= 3) {
          clearInterval(client.windowTimer);
          this.logger.warn(
            `WS message rate limit: 3 consecutive violations - user_id=${client.user.userId} document_id=${client.user.documentId}`,
          );
          client.close(4029, 'Message rate limit exceeded');
        }
      } else {
        client.consecutiveViolations = 0;
      }
    }, 1_000);

    // Record this connection in the cluster-wide presence count. Done after the room
    // and Redis channels are set up so a failure above never leaves a counted-but-dead
    // connection behind. presenceCounted gates the matching decrement in handleDisconnect.
    const connectionCount = await this.redisService.presenceJoin(
      documentId,
      client.user.userId,
    );
    client.presenceCounted = true;

    // Only the user's first connection flips them to "present" — announce it once, and
    // resolve their display name (a single lookup, not per-reconnect) for the roster.
    if (connectionCount === 1) {
      const user = await this.usersService.getUserById(client.user.userId);
      const displayName =
        `${user.firstName} ${user.lastName}`.trim() || client.user.email;
      await this.redisService.setPresenceIdentity(
        documentId,
        client.user.userId,
        displayName,
      );
      await this.broadcastPresence(
        documentId,
        this.roomsMap.get(documentId),
        client.user.userId,
        displayName,
        'online',
        client,
      );
    }

    // The current { userId: displayName } roster, sent to the joining client so it can
    // render who is already present without a separate request. Includes this user;
    // the client filters its own id out.
    const participants = await this.redisService.presenceRoster(documentId);

    const snapshot = await this.snapshotsService.getLatestSnapshot(documentId);
    const afterSequence = snapshot?.operationSequence ?? 0;

    const operations = await this.operationsService.getOperationsSinceSequence(
      documentId,
      afterSequence,
    );

    // clockValue is a bigint (not JSON-serializable) and yjsUpdate is binary;
    // emit them as a string and base64 so the payload survives JSON.stringify
    // and matches the base64 snapshot convention above.
    const delta = operations.map((op) => ({
      ...op,
      clockValue: op.clockValue?.toString() ?? null,
      yjsUpdate: op.yjsUpdate ? op.yjsUpdate.toString('base64') : null,
    }));

    client.send(
      JSON.stringify({
        event: 'initial_state',
        data: {
          snapshot: snapshot ? snapshot.contentBlob.toString('base64') : null,
          delta,
          participants,
        },
      }),
    );
  }

  @SubscribeMessage('update')
  async handleUpdate(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: Buffer | number[],
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

    if (typeof client.messageCount === 'number') {
      client.messageCount++;
      if (client.messageCount === this.wsMessageRateLimit + 1) {
        this.logger.warn(
          `WS message rate limit warning - user_id=${client.user.userId} document_id=${documentId}`,
        );
        client.send(
          JSON.stringify({
            event: 'rate_limit_warning',
            data: { message: 'Message rate limit exceeded' },
          }),
        );
      }
      if (client.messageCount > this.wsMessageRateLimit) return;
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

        const opServiceResult = await this.operationsService.insertOperation(
          tx,
          {
            documentId,
            userId: client.user.userId,
            yjsUpdate: update,
            type: classified.type,
            source: 'human',
            payload: classified.payload,
            clockValue,
          },
        );

        const outboxId = await this.outboxService.insertOutboxEntry(tx, {
          documentId,
          operationId: opServiceResult.id,
          payload: update,
        });

        const result = {
          outboxId,
          ...opServiceResult,
        };

        return result;
      });

      await this.outboxService.enqueueDelivery(opResult.outboxId);

      // Cross-instance and durable fan-out flow through the transactional outbox enqueued
      // above: the outbox processor publishes to `doc:${documentId}`, and every instance
      // subscribed to this document relays that frame into its local room. We still hand the
      // update to this instance's own connected peers directly for low-latency local
      // delivery; the matching outbox frame this instance later receives re-applies the same
      // Yjs update, which is an idempotent no-op. (A single inline publish here is avoided so
      // a redis hiccup can't drop the broadcast — the outbox retries until delivered.)
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
    name: string,
    status: 'online' | 'offline',
    exclude?: AuthenticatedSocket,
  ) {
    // Presence is sent as a JSON text frame (not a binary buffer) so the client can rely
    // on frame type alone: binary => Yjs document update, text => JSON event. No sniffing.
    const message = JSON.stringify({ type: 'presence', userId, name, status });

    // Send to clients on this instance directly first — no need to wait on a Redis
    // round trip for the common case where they're all on the same process. The
    // triggering socket (e.g. the user who just joined) is skipped via `exclude`.
    room?.forEach((socket) => {
      if (socket !== exclude && socket.readyState === WebSocket.OPEN) {
        socket.send(message);
      }
    });

    // Then publish for other instances' rooms, since `room` here is only ever local.
    // The instanceId prefix is binary, so the frame is carried as bytes over pub/sub and
    // decoded back to a text frame by the subscriber before it reaches a client.
    await this.redisService.publish(
      `presence:${documentId}`,
      Buffer.concat([this.instanceId, Buffer.from(message)]),
    );
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    if (client.windowTimer) {
      clearInterval(client.windowTimer);
      client.windowTimer = undefined;
    }

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

      // Decrement this user's cluster-wide connection count. Only announce offline when
      // their last connection closed (remaining === 0); other tabs/instances keep them
      // present. Guarded by presenceCounted so a join that failed before counting (and
      // thus never incremented) can't drive the count negative here.
      if (client.presenceCounted) {
        const { remaining, name } = await this.redisService.presenceLeave(
          documentId,
          client.user.userId,
        );
        if (remaining === 0) {
          await this.broadcastPresence(
            documentId,
            room,
            client.user.userId,
            name ?? client.user.email,
            'offline',
          );
        }
      }

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
            { jobId: `snapshot-${documentId}` },
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
