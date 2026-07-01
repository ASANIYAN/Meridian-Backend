import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.test') });

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import WebSocket from 'ws';
import { createTestApp } from './helpers/create-test-app';
import { MockMailService } from './helpers/mock-mail.service';
import {
  truncateAll,
  flushRedis,
  getUserIdByEmail,
  addMembership,
} from './helpers/db';

const PORT = Number(process.env.PORT);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type PresenceMessage = {
  type?: string;
  event?: string;
  status?: string;
  userId?: string;
  name?: string;
  data?: { participants?: Record<string, string> };
};

describe('Presence roster (e2e)', () => {
  let app: INestApplication;
  let mockMail: MockMailService;
  const sockets: WebSocket[] = [];

  beforeAll(async () => {
    ({ app, mockMail } = await createTestApp());
  });

  afterEach(async () => {
    for (const ws of sockets.splice(0)) {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    }
    await truncateAll();
    await flushRedis();
    mockMail.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  // --- Helpers ---

  async function createUser(email: string): Promise<string> {
    const password = 'Password123!';
    await request(app.getHttpServer())
      .post('/v1/auth/signup')
      .send({ email, firstName: 'Test', lastName: 'User', password });
    const token = mockMail.getVerificationToken(email)!;
    await request(app.getHttpServer())
      .post('/v1/auth/verify-email')
      .send({ email, token });
    const loginRes = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email, password });
    return loginRes.body.data.token as string;
  }

  async function createDocument(authToken: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/v1/documents')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ title: 'Doc' });
    return res.body.data.id as string;
  }

  // Opens a socket, starts buffering every JSON (text) frame, and resolves once the
  // connection is open. Binary frames (Yjs updates) are ignored.
  function connect(token: string): Promise<{
    ws: WebSocket;
    messages: PresenceMessage[];
  }> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${PORT}/?token=${token}`);
      const messages: PresenceMessage[] = [];
      sockets.push(ws);
      ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
        if (isBinary) return;
        try {
          const text = (data as Buffer).toString('utf8');
          messages.push(JSON.parse(text) as PresenceMessage);
        } catch {
          /* ignore non-JSON */
        }
      });
      ws.on('open', () => resolve({ ws, messages }));
      ws.on('error', reject);
    });
  }

  // Sends join and resolves with the initial_state frame.
  async function join(
    ws: WebSocket,
    messages: PresenceMessage[],
    documentId: string,
  ): Promise<PresenceMessage> {
    ws.send(
      JSON.stringify({ event: 'join', data: { document_id: documentId } }),
    );
    return waitFor(messages, (m) => m.event === 'initial_state');
  }

  async function waitFor(
    messages: PresenceMessage[],
    predicate: (m: PresenceMessage) => boolean,
    timeoutMs = 4000,
  ): Promise<PresenceMessage> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const found = messages.find(predicate);
      if (found) return found;
      await sleep(40);
    }
    throw new Error('timed out waiting for message');
  }

  function presence(
    messages: PresenceMessage[],
    status: string,
    userId: string,
  ) {
    return (m: PresenceMessage) =>
      m.type === 'presence' && m.status === status && m.userId === userId;
  }

  // --- Tests ---

  it('a joining client receives a roster of everyone already present', async () => {
    const tokenA = await createUser('a@test.com');
    const tokenB = await createUser('b@test.com');
    const userA = await getUserIdByEmail('a@test.com');
    const userB = await getUserIdByEmail('b@test.com');
    const docId = await createDocument(tokenA); // A is author
    await addMembership(docId, userB, 'editor');

    const a = await connect(tokenA);
    const aInitial = await join(a.ws, a.messages, docId);
    // A is alone — roster contains only A.
    expect(Object.keys(aInitial.data!.participants!)).toEqual([userA]);

    const b = await connect(tokenB);
    const bInitial = await join(b.ws, b.messages, docId);
    // B joins with A already present — roster contains both.
    expect(Object.keys(bInitial.data!.participants!).sort()).toEqual(
      [userA, userB].sort(),
    );
  });

  it('an already-present client is told when another user joins and leaves', async () => {
    const tokenA = await createUser('a@test.com');
    const tokenB = await createUser('b@test.com');
    const userB = await getUserIdByEmail('b@test.com');
    const docId = await createDocument(tokenA);
    await addMembership(docId, userB, 'editor');

    const a = await connect(tokenA);
    await join(a.ws, a.messages, docId);

    const b = await connect(tokenB);
    await join(b.ws, b.messages, docId);

    // A receives B's online (as a JSON text frame, not binary).
    const online = await waitFor(
      a.messages,
      presence(a.messages, 'online', userB),
    );
    expect(online.name).toBe('Test User');

    b.ws.close();

    // A receives B's offline once B's only connection closes.
    await waitFor(a.messages, presence(a.messages, 'offline', userB));
  });

  it('ref-counts connections: a second tab emits no extra online, and offline fires only on the last close', async () => {
    const tokenA = await createUser('a@test.com');
    const tokenB = await createUser('b@test.com');
    const userB = await getUserIdByEmail('b@test.com');
    const docId = await createDocument(tokenA);
    await addMembership(docId, userB, 'editor');

    const a = await connect(tokenA);
    await join(a.ws, a.messages, docId);

    // B's first tab → A sees exactly one online.
    const b1 = await connect(tokenB);
    await join(b1.ws, b1.messages, docId);
    await waitFor(a.messages, presence(a.messages, 'online', userB));

    // B's second tab → no additional online for B.
    const b2 = await connect(tokenB);
    await join(b2.ws, b2.messages, docId);
    await sleep(800);
    const onlineCount = a.messages.filter(
      presence(a.messages, 'online', userB),
    ).length;
    expect(onlineCount).toBe(1);

    // Closing one of B's two tabs → still present, no offline.
    b1.ws.close();
    await sleep(800);
    expect(
      a.messages.filter(presence(a.messages, 'offline', userB)),
    ).toHaveLength(0);

    // Closing B's last tab → offline fires once.
    b2.ws.close();
    await waitFor(a.messages, presence(a.messages, 'offline', userB));
  });
});
