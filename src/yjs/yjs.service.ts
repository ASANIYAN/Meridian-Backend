import * as Y from 'yjs';
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class YjsService {
  private readonly logger = new Logger(YjsService.name);

  decodeUpdate(doc: Y.Doc, update: Buffer): void {
    if (!update) {
      this.logger.error('No buffer passed');
      throw new Error('No buffer passed');
    }

    Y.applyUpdate(doc, update);
  }

  extractText(doc: Y.Doc): string {
    return doc.getText('content').toJSON();
  }

  encodeState(doc: Y.Doc): Buffer {
    return Buffer.from(Y.encodeStateAsUpdate(doc));
  }

  encodeStateVector(doc: Y.Doc): Record<string, number> {
    const encoded = Y.encodeStateVector(doc);
    const map = Y.decodeStateVector(encoded); // Map<number clientId, number clock>
    return Object.fromEntries(map);
  }

  classifyUpdate(update: Buffer): {
    type: 'insert' | 'delete' | 'format';
    payload: Record<string, unknown>;
    receivedClock: number;
  } {
    const decoded = Y.decodeUpdate(update);

    const receivedClock = Math.max(
      0,
      ...decoded.structs.map((s) => s.id.clock + s.length),
    );

    const insertStruct = decoded.structs.find(
      (s): s is Y.Item =>
        s instanceof Y.Item &&
        typeof (s.content as Y.ContentString).str === 'string',
    );

    const hasDeletes = decoded.ds.clients.size > 0;

    const formatStruct = decoded.structs.find(
      (s): s is Y.Item =>
        s instanceof Y.Item &&
        typeof (s.content as Y.ContentFormat).key === 'string',
    );

    if (insertStruct) {
      const content = insertStruct.content as Y.ContentString;
      const insertId = `${insertStruct.id.client}:${insertStruct.id.clock}`;
      return {
        type: 'insert',
        payload: { insert_id: insertId, content: content.str },
        receivedClock,
      };
    }

    if (hasDeletes) {
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
