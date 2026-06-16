import * as Y from 'yjs';
import { YjsService } from './yjs.service';
import { Test, TestingModule } from '@nestjs/testing';

describe('YjsService', () => {
  let service: YjsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [YjsService],
    }).compile();

    service = module.get<YjsService>(YjsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('decodeUpdate', () => {
    it('applies a binary update onto the target Y.Doc', () => {
      const source = new Y.Doc();
      source.getText('content').insert(0, 'hello');
      const update = Buffer.from(Y.encodeStateAsUpdate(source));

      const target = new Y.Doc();
      service.decodeUpdate(target, update);

      expect(target.getText('content').toJSON()).toBe('hello');
    });

    it('throws when no update buffer is passed', () => {
      const doc = new Y.Doc();

      expect(() =>
        service.decodeUpdate(doc, undefined as unknown as Buffer),
      ).toThrow('No buffer passed');
    });
  });

  describe('extractText', () => {
    it('returns the plain text content of a Y.Doc', () => {
      const doc = new Y.Doc();
      doc.getText('content').insert(0, 'hello world');

      expect(service.extractText(doc)).toBe('hello world');
    });

    it('returns an empty string for a doc with no content', () => {
      const doc = new Y.Doc();

      expect(service.extractText(doc)).toBe('');
    });
  });

  describe('encodeState', () => {
    it('returns a Buffer', () => {
      const doc = new Y.Doc();
      doc.getText('content').insert(0, 'hello');

      expect(Buffer.isBuffer(service.encodeState(doc))).toBe(true);
    });

    it('roundtrips: applying the encoded state to a new doc reproduces the same content', () => {
      const source = new Y.Doc();
      source.getText('content').insert(0, 'hello world');

      const blob = service.encodeState(source);

      const target = new Y.Doc();
      service.decodeUpdate(target, blob);

      expect(target.getText('content').toJSON()).toBe('hello world');
    });
  });

  describe('encodeStateVector', () => {
    it('maps the doc client id to its clock as a plain object', () => {
      const doc = new Y.Doc();
      doc.getText('content').insert(0, 'hello');

      const vector = service.encodeStateVector(doc);

      expect(vector).not.toBeInstanceOf(Map);
      expect(vector[doc.clientID.toString()]).toBeGreaterThan(0);
    });

    it('survives JSON serialization unchanged', () => {
      const doc = new Y.Doc();
      doc.getText('content').insert(0, 'hello');

      const vector = service.encodeStateVector(doc);

      expect(JSON.parse(JSON.stringify(vector))).toEqual(vector);
    });

    it('returns an empty object for a doc with no edits', () => {
      const doc = new Y.Doc();

      expect(service.encodeStateVector(doc)).toEqual({});
    });
  });
});
