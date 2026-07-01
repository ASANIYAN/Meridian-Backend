import * as Y from 'yjs';
import { Injectable, Logger } from '@nestjs/common';

type DescribableYjsContent = {
  isCountable(): boolean;
  getLength(): number;
  getContent(): unknown[];
};

type LinearXmlText = {
  node: Y.XmlText;
  start: number;
  end: number;
};

@Injectable()
export class YjsService {
  private readonly logger = new Logger(YjsService.name);

  // Applies a binary Yjs update to a document, mutating its in-memory state.
  decodeUpdate(doc: Y.Doc, update: Buffer): void {
    if (!update) {
      this.logger.error('No buffer passed');
      throw new Error('No buffer passed');
    }

    Y.applyUpdate(doc, update);
  }

  // After a doc is reconstructed purely from binary updates, its top-level 'content'
  // type is integrated as a bare AbstractType — Yjs only assigns the concrete
  // constructor (Y.XmlFragment vs Y.Text) when application code first accesses the type
  // through the matching getter. Until that happens every `instanceof Y.XmlFragment`
  // check below is false, so rich-text docs fall through to the plain-text path and
  // edits land as raw strings at the fragment root (invisible to ProseMirror). Detect
  // the intended type from the integrated structure and materialize it once, up front.
  materializeContentType(doc: Y.Doc): void {
    const content = this.getExistingContentType(doc);
    // Nothing integrated yet, or already materialized by a prior getter call.
    if (
      !content ||
      content instanceof Y.XmlFragment ||
      content instanceof Y.Text
    ) {
      return;
    }

    if (this.looksLikeXmlFragment(content)) {
      doc.getXmlFragment('content');
    } else {
      doc.getText('content');
    }
  }

  // An XmlFragment's children are nested types (XmlElement/XmlText → ContentType), while
  // a plain Y.Text holds character runs (ContentString). The first non-deleted item tells
  // the two apart. Defaults to plain text when the type is empty or ambiguous.
  private looksLikeXmlFragment(type: Y.AbstractType<unknown>): boolean {
    let item = type._start;
    while (item) {
      if (!item.deleted) {
        if (item.content instanceof Y.ContentType) return true;
        if (item.content instanceof Y.ContentString) return false;
      }
      item = item.right;
    }
    return false;
  }

  // Returns the plain text content of the shared 'content' text type in the doc.
  extractText(doc: Y.Doc): string {
    const content = this.getExistingContentType(doc);
    if (content instanceof Y.Text) {
      return content.toJSON();
    }

    if (content instanceof Y.XmlFragment) {
      return this.extractXmlText(content);
    }

    return doc.getText('content').toJSON();
  }

  insertText(doc: Y.Doc, position: number, text: string): void {
    const content = this.getExistingContentType(doc);
    if (!(content instanceof Y.XmlFragment)) {
      (content instanceof Y.Text ? content : doc.getText('content')).insert(
        position,
        text,
      );
      return;
    }

    const xmlTextNodes = this.linearizeXmlText(content);
    if (xmlTextNodes.length === 0) {
      const xmlText = new Y.XmlText();
      xmlText.insert(0, text);
      content.insert(0, [xmlText]);
      return;
    }

    const target =
      xmlTextNodes.find((node) => position <= node.end) ??
      xmlTextNodes[xmlTextNodes.length - 1];

    target.node.insert(
      this.clamp(position - target.start, 0, target.end),
      text,
    );
  }

  deleteText(doc: Y.Doc, start: number, length: number): void {
    const content = this.getExistingContentType(doc);
    if (!(content instanceof Y.XmlFragment)) {
      (content instanceof Y.Text ? content : doc.getText('content')).delete(
        start,
        length,
      );
      return;
    }

    const xmlTextNodes = this.linearizeXmlText(content);
    this.forEachXmlTextRange(
      xmlTextNodes,
      start,
      length,
      (node, from, size) => {
        node.delete(from, size);
      },
    );
  }

  formatText(
    doc: Y.Doc,
    start: number,
    length: number,
    attributes: Record<string, unknown>,
  ): void {
    const content = this.getExistingContentType(doc);
    if (!(content instanceof Y.XmlFragment)) {
      (content instanceof Y.Text ? content : doc.getText('content')).format(
        start,
        length,
        attributes,
      );
      return;
    }

    const xmlTextNodes = this.linearizeXmlText(content);
    this.forEachXmlTextRange(
      xmlTextNodes,
      start,
      length,
      (node, from, size) => {
        node.format(from, size, attributes);
      },
    );
  }

  // Serialises the entire document state to binary — equivalent to one update that
  // brings any empty doc to the current state. Used to write snapshot content_blob.
  encodeState(doc: Y.Doc): Buffer {
    return Buffer.from(Y.encodeStateAsUpdate(doc));
  }

  // Returns a plain JSON map of { clientId → highestClock } for every peer the doc
  // has seen. Stored as the snapshot version_vector so future syncs can tell which
  // operations are already included.
  encodeStateVector(doc: Y.Doc): Record<string, number> {
    const encoded = Y.encodeStateVector(doc);
    // decodeStateVector turns the compact binary back into a readable Map.
    const map = Y.decodeStateVector(encoded);
    return Object.fromEntries(map);
  }

  describeUpdate(update: Buffer): Record<string, unknown> {
    const decoded = Y.decodeUpdate(update);
    return {
      byteLength: update.byteLength,
      structCount: decoded.structs.length,
      structs: decoded.structs.map((struct) => {
        const content =
          struct instanceof Y.Item
            ? this.describeContent(struct.content)
            : null;

        return {
          kind: struct.constructor.name,
          id: `${struct.id.client}:${struct.id.clock}`,
          length: struct.length,
          content,
        };
      }),
      deleteSet: [...decoded.ds.clients].map(([clientId, ranges]) => ({
        clientId,
        ranges: ranges.map((range) => ({
          clock: range.clock,
          length: range.len,
        })),
      })),
    };
  }

  // Inspects a raw Yjs binary update and returns its semantic type (insert/delete/format)
  // plus a human-readable payload and the highest Lamport clock value it carries.
  classifyUpdate(update: Buffer): {
    type: 'insert' | 'delete' | 'format' | 'yjs_update';
    payload: Record<string, unknown>;
    receivedClock: number;
  } {
    // decodeUpdate breaks the binary into structs (inserts/formats) and a delete set (ds).
    const decoded = Y.decodeUpdate(update);

    // Each struct has an id.clock. Adding its length gives the clock of the last
    // position it occupies — the max across all structs is the highest clock in this update.
    const receivedClock = Math.max(
      0,
      ...decoded.structs.map((s) => s.id.clock + s.length),
    );

    // A struct with a string content is a text insertion.
    const insertStruct = decoded.structs.find(
      (s): s is Y.Item =>
        s instanceof Y.Item &&
        typeof (s.content as Y.ContentString).str === 'string',
    );

    // Yjs tracks deletions separately in a delete set (ds), not as structs.
    const hasDeletes = decoded.ds.clients.size > 0;

    // A struct with a format key is a rich-text format mark (e.g. bold, italic).
    // Format marks come in open/close pairs — two structs with the same key.
    const formatStruct = decoded.structs.find(
      (s): s is Y.Item =>
        s instanceof Y.Item &&
        typeof (s.content as Y.ContentFormat).key === 'string',
    );

    if (insertStruct) {
      const content = insertStruct.content as Y.ContentString;
      // client:clock is the unique CRDT identity of this insert position.
      const insertId = `${insertStruct.id.client}:${insertStruct.id.clock}`;
      return {
        type: 'insert',
        payload: { insert_id: insertId, content: content.str },
        receivedClock,
      };
    }

    if (hasDeletes) {
      // The delete set maps clientId → array of clock ranges that were deleted.
      const [[clientId, ranges]] = [...decoded.ds.clients];
      const deleteId = `${clientId}:${ranges[0].clock}`;
      return {
        type: 'delete',
        payload: { delete_id: deleteId },
        receivedClock,
      };
    }

    if (formatStruct) {
      const content = formatStruct.content as Y.ContentFormat;
      // The second struct with the same key is the closing mark of the format range.
      const closeStruct = decoded.structs.find(
        (s): s is Y.Item =>
          s instanceof Y.Item &&
          s !== formatStruct &&
          typeof (s.content as Y.ContentFormat).key === 'string',
      );
      const startId = `${formatStruct.id.client}:${formatStruct.id.clock}`;
      const endId = closeStruct
        ? `${closeStruct.id.client}:${closeStruct.id.clock}`
        : startId;
      return {
        type: 'format',
        payload: {
          start_id: startId,
          end_id: endId,
          formatting: { [content.key]: content.value },
        },
        receivedClock,
      };
    }

    if (decoded.structs.length > 0) {
      return {
        type: 'yjs_update',
        payload: { struct_count: decoded.structs.length },
        receivedClock,
      };
    }

    throw new Error('Unable to classify Yjs update: no recognizable content');
  }

  private describeContent(
    describableContent: DescribableYjsContent,
  ): Record<string, unknown> {
    const contentSummary: Record<string, unknown> = {
      kind: this.constructorName(describableContent),
      countable: describableContent.isCountable(),
      length: describableContent.getLength(),
    };

    if (describableContent instanceof Y.ContentString) {
      return { ...contentSummary, value: describableContent.str };
    }

    if (describableContent instanceof Y.ContentFormat) {
      return {
        ...contentSummary,
        key: describableContent.key,
        value: describableContent.value,
      };
    }

    const values = describableContent.getContent();
    if (values.length > 0) {
      return {
        ...contentSummary,
        values: values.map((value) => this.describeContentValue(value)),
      };
    }

    return contentSummary;
  }

  private extractXmlText(type: Y.AbstractType<unknown>): string {
    if (type instanceof Y.XmlText) {
      return String(type.toString());
    }

    if (type instanceof Y.XmlElement || type instanceof Y.XmlFragment) {
      return (type.toArray() as unknown[])
        .map((child) => {
          if (child instanceof Y.AbstractType) {
            return this.extractXmlText(child);
          }

          return '';
        })
        .join('');
    }

    return '';
  }

  private getExistingContentType(doc: Y.Doc): Y.AbstractType<unknown> | null {
    return (
      (
        doc as unknown as { share: Map<string, Y.AbstractType<unknown>> }
      ).share.get('content') ?? null
    );
  }

  private linearizeXmlText(fragment: Y.XmlFragment): LinearXmlText[] {
    const nodes: LinearXmlText[] = [];
    let offset = 0;

    const visit = (type: Y.AbstractType<unknown>) => {
      if (type instanceof Y.XmlText) {
        const length = String(type.toString()).length;
        nodes.push({ node: type, start: offset, end: offset + length });
        offset += length;
        return;
      }

      if (type instanceof Y.XmlElement || type instanceof Y.XmlFragment) {
        for (const child of type.toArray() as unknown[]) {
          if (child instanceof Y.AbstractType) {
            visit(child);
          }
        }
      }
    };

    visit(fragment);
    return nodes;
  }

  private forEachXmlTextRange(
    nodes: LinearXmlText[],
    start: number,
    length: number,
    callback: (node: Y.XmlText, from: number, length: number) => void,
  ): void {
    const end = start + length;

    for (const node of nodes) {
      const overlapStart = Math.max(start, node.start);
      const overlapEnd = Math.min(end, node.end);
      if (overlapStart >= overlapEnd) continue;

      callback(node.node, overlapStart - node.start, overlapEnd - overlapStart);
    }
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  private describeContentValue(value: unknown): unknown {
    if (value instanceof Uint8Array) {
      return { kind: 'Uint8Array', byteLength: value.byteLength };
    }

    if (value && typeof value === 'object') {
      return {
        kind: this.constructorName(value),
      };
    }

    return value;
  }

  private constructorName(value: unknown): string {
    if (
      value &&
      typeof value === 'object' &&
      'constructor' in value &&
      typeof value.constructor === 'function' &&
      value.constructor.name
    ) {
      return value.constructor.name;
    }

    return typeof value;
  }
}
