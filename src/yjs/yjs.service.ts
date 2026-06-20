import * as Y from 'yjs';
import { Injectable, Logger } from '@nestjs/common';

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

  // Returns the plain text content of the shared 'content' text type in the doc.
  extractText(doc: Y.Doc): string {
    return doc.getText('content').toJSON();
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

  // Inspects a raw Yjs binary update and returns its semantic type (insert/delete/format)
  // plus a human-readable payload and the highest Lamport clock value it carries.
  classifyUpdate(update: Buffer): {
    type: 'insert' | 'delete' | 'format';
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

    throw new Error('Unable to classify Yjs update: no recognizable content');
  }
}
