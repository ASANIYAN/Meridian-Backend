import * as Y from 'yjs';
import { YjsService } from './yjs.service';
import { beforeEach, describe, expect, it } from '@jest/globals';
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

    it('returns text from rich editor XmlFragment content', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('content');
      const paragraph = new Y.XmlElement('paragraph');
      const text = new Y.XmlText();
      text.insert(0, 'hello rich world');
      paragraph.insert(0, [text]);
      fragment.insert(0, [paragraph]);

      expect(service.extractText(doc)).toBe('hello rich world');
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

  describe('plain text operations', () => {
    it('applies inserts to rich editor XmlFragment content', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('content');
      const paragraph = new Y.XmlElement('paragraph');
      const text = new Y.XmlText();
      text.insert(0, 'hello world');
      paragraph.insert(0, [text]);
      fragment.insert(0, [paragraph]);

      service.insertText(doc, 6, 'rich ');

      expect(service.extractText(doc)).toBe('hello rich world');
      expect(text.toString()).toBe('hello rich world');
    });

    it('applies deletes across rich editor XmlText nodes', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('content');
      const first = new Y.XmlText();
      const second = new Y.XmlText();
      first.insert(0, 'hello ');
      second.insert(0, 'rich world');
      fragment.insert(0, [first, second]);

      service.deleteText(doc, 6, 5);

      expect(service.extractText(doc)).toBe('hello world');
    });
  });

  describe('describeUpdate', () => {
    it('returns a decoded summary for text updates', () => {
      const doc = new Y.Doc();
      doc.getText('content').insert(0, 'hello');
      const update = Buffer.from(Y.encodeStateAsUpdate(doc));

      expect(service.describeUpdate(update)).toMatchObject({
        byteLength: expect.any(Number),
        structCount: expect.any(Number),
        structs: [
          expect.objectContaining({
            kind: 'Item',
            id: expect.any(String),
            length: expect.any(Number),
            content: expect.objectContaining({
              kind: 'ContentString',
              countable: true,
              value: 'hello',
            }),
          }),
        ],
        deleteSet: [],
      });
    });

    it('returns content type metadata for rich editor structure updates', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('content');
      const paragraph = new Y.XmlElement('paragraph');
      paragraph.setAttribute('textAlign', 'right');
      fragment.insert(0, [paragraph]);
      const update = Buffer.from(Y.encodeStateAsUpdate(doc));

      expect(service.describeUpdate(update)).toMatchObject({
        byteLength: expect.any(Number),
        structCount: expect.any(Number),
        structs: expect.arrayContaining([
          expect.objectContaining({
            content: expect.objectContaining({
              kind: 'ContentType',
              values: [
                expect.objectContaining({
                  kind: 'YXmlElement',
                }),
              ],
            }),
          }),
        ]),
      });
    });
  });

  describe('classifyUpdate', () => {
    it('classifies text alignment-style Yjs structs as generic updates', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('content');
      const paragraph = new Y.XmlElement('paragraph');
      paragraph.setAttribute('textAlign', 'right');
      fragment.insert(0, [paragraph]);
      const update = Buffer.from(Y.encodeStateAsUpdate(doc));

      expect(service.classifyUpdate(update)).toMatchObject({
        type: 'yjs_update',
        payload: { struct_count: expect.any(Number) },
        receivedClock: expect.any(Number),
      });
    });
  });
});
