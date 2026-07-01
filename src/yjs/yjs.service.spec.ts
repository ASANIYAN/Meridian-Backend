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

  describe('materializeContentType', () => {
    // Rebuilds a doc the way AiService.reconstructDocument does: purely by applying a
    // binary update, so 'content' starts as a bare AbstractType until materialized.
    const reconstructFromUpdate = (source: Y.Doc): Y.Doc => {
      const doc = new Y.Doc();
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(source));
      return doc;
    };

    it('materializes rich content as an XmlFragment so edits land inside the structure', () => {
      const source = new Y.Doc();
      const fragment = source.getXmlFragment('content');
      const paragraph = new Y.XmlElement('paragraph');
      const text = new Y.XmlText();
      text.insert(0, 'hello world');
      paragraph.insert(0, [text]);
      fragment.insert(0, [paragraph]);

      const doc = reconstructFromUpdate(source);
      // Without materialization the type is a bare AbstractType and this insert would
      // land as raw text at the fragment root (invisible to the rich editor).
      service.materializeContentType(doc);
      service.insertText(doc, 6, 'rich ');

      const rendered = service.extractText(doc);
      expect(rendered).toBe('hello rich world');
      // Materialization assigned the concrete XmlFragment type, so the edit is nested
      // inside the rich structure rather than dropped as raw text at the fragment root.
      expect(doc.share.get('content')).toBeInstanceOf(Y.XmlFragment);
    });

    it('materializes plain content as Y.Text', () => {
      const source = new Y.Doc();
      source.getText('content').insert(0, 'hello world');

      const doc = reconstructFromUpdate(source);
      service.materializeContentType(doc);
      service.insertText(doc, 6, 'plain ');

      expect(service.extractText(doc)).toBe('hello plain world');
      expect(doc.share.get('content')).toBeInstanceOf(Y.Text);
    });

    it('is a no-op for a doc with no content yet', () => {
      const doc = new Y.Doc();
      expect(() => service.materializeContentType(doc)).not.toThrow();
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

    it('wraps the first insert into an empty fragment in a paragraph element, not bare text', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('content');

      service.insertText(doc, 0, 'hello world');

      // ProseMirror/y-prosemirror requires every top-level child to be a block element;
      // a bare Y.XmlText at the root is what crashes hydration (el.toArray is not a function).
      const firstChild = fragment.get(0);
      expect(firstChild).toBeInstanceOf(Y.XmlElement);
      expect((firstChild as Y.XmlElement).nodeName).toBe('paragraph');
      expect(service.extractText(doc)).toBe('hello world');
    });

    it('materializes brand-new content as an XmlFragment paragraph, not a Y.Text', () => {
      // Mirrors an AI edit on a document with no snapshot: nothing is integrated under
      // 'content' yet, so the write path must choose XmlFragment (rich) over Y.Text (plain).
      const doc = new Y.Doc();

      service.insertText(doc, 0, 'first words');

      expect(doc.share.get('content')).toBeInstanceOf(Y.XmlFragment);
      const firstChild = doc.getXmlFragment('content').get(0);
      expect(firstChild).toBeInstanceOf(Y.XmlElement);
      expect(service.extractText(doc)).toBe('first words');
    });

    it('keeps editing a legacy Y.Text content on the plain-text path', () => {
      const doc = new Y.Doc();
      doc.getText('content').insert(0, 'legacy text');

      service.insertText(doc, 7, 'plain ');

      expect(doc.share.get('content')).toBeInstanceOf(Y.Text);
      expect(service.extractText(doc)).toBe('legacy plain text');
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

    it('classifies a format op as format even when its diff carries a historical delete set', () => {
      // Reproduces how AI edits are encoded: encodeStateAsUpdate always serialises the
      // doc's FULL delete set, so a pure format op co-travels with earlier tombstones.
      // hasDeletes is therefore true, but the op is still a format — not a delete.
      const doc = new Y.Doc();
      const text = doc.getText('content');
      text.insert(0, 'hello world');
      text.delete(0, 1); // historical tombstone, unrelated to the format below

      const vectorBefore = Y.encodeStateVector(doc);
      text.format(1, 5, { bold: true });
      const update = Buffer.from(Y.encodeStateAsUpdate(doc, vectorBefore));

      // Sanity: the diff really does carry a delete set that would previously win.
      expect(Y.decodeUpdate(update).ds.clients.size).toBeGreaterThan(0);

      expect(service.classifyUpdate(update)).toMatchObject({
        type: 'format',
        payload: { formatting: { bold: true } },
      });
    });

    it('classifies a pure deletion as delete', () => {
      const doc = new Y.Doc();
      const text = doc.getText('content');
      text.insert(0, 'hello world');

      const vectorBefore = Y.encodeStateVector(doc);
      text.delete(0, 5);
      const update = Buffer.from(Y.encodeStateAsUpdate(doc, vectorBefore));

      expect(service.classifyUpdate(update)).toMatchObject({
        type: 'delete',
        payload: { delete_id: expect.any(String) },
      });
    });
  });
});
