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
}
