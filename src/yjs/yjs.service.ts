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

// The flat text the AI edits against renders each top-level block on its own line,
// separated by a blank line. A blank line in inserted text is therefore the signal to
// start a new block (paragraph), mirroring ProseMirror's block+ structure.
const BLOCK_SEPARATOR = '\n\n';
const BLOCK_BREAK = /\n{2,}/;

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
      return this.extractFragmentText(content);
    }

    // No content type integrated yet. Return empty without calling doc.getText, which
    // would materialize 'content' as a Y.Text and force every later write onto the
    // plain-text path — the write paths choose Y.XmlFragment for new content instead.
    return '';
  }

  // Resolves the concrete type to write edits into. Legacy docs whose 'content' was
  // authored as a plain Y.Text keep that type; anything else (including brand-new docs
  // with no content yet) is materialized as an XmlFragment so first writes produce
  // ProseMirror block structure rather than a Y.Text.
  private resolveWritableContent(doc: Y.Doc): Y.Text | Y.XmlFragment {
    const content = this.getExistingContentType(doc);
    if (content instanceof Y.Text) return content;
    if (content instanceof Y.XmlFragment) return content;
    return doc.getXmlFragment('content');
  }

  // Builds a block-level <paragraph> wrapping a single Y.XmlText, matching the frontend
  // Tiptap/StarterKit schema. An empty paragraph still carries an empty XmlText so later
  // inserts have an inline node to target.
  private createParagraph(text?: string): Y.XmlElement {
    const paragraph = new Y.XmlElement('paragraph');
    const xmlText = new Y.XmlText();
    if (text) xmlText.insert(0, text);
    paragraph.insert(0, [xmlText]);
    return paragraph;
  }

  // Turns block-separated text into one <paragraph> per block, so a multi-paragraph string
  // seeds real block structure instead of a single paragraph with literal newlines.
  private createParagraphs(text: string): Y.XmlElement[] {
    return text
      .split(BLOCK_BREAK)
      .map((segment) => this.createParagraph(segment));
  }

  // Inserts text at a flat character offset. Legacy Y.Text docs are edited directly; rich
  // XmlFragment docs map the offset onto the XmlText node it lands in. Text carrying a
  // blank line is split into new sibling <paragraph> blocks rather than inlined, so the AI
  // (and seeds) can author real paragraph structure.
  insertText(doc: Y.Doc, position: number, text: string): void {
    const content = this.resolveWritableContent(doc);
    if (content instanceof Y.Text) {
      content.insert(position, text);
      return;
    }

    const xmlTextNodes = this.linearizeXmlText(content);
    if (xmlTextNodes.length === 0) {
      // ProseMirror requires every top-level child of the content fragment to be a block
      // Y.XmlElement — a bare Y.XmlText at the root crashes y-prosemirror's hydration
      // (el.toArray is not a function). Wrap the text in one or more paragraphs.
      content.insert(0, this.createParagraphs(text));
      return;
    }

    const target =
      xmlTextNodes.find((node) => position <= node.end) ??
      xmlTextNodes[xmlTextNodes.length - 1];
    const localOffset = this.clamp(
      position - target.start,
      0,
      target.end - target.start,
    );

    const segments = text.split(BLOCK_BREAK);
    if (segments.length <= 1) {
      target.node.insert(localOffset, text);
      return;
    }

    this.insertBlocks(target.node, localOffset, segments);
  }

  // Splits the block containing `targetNode` at `localOffset` and interleaves `segments`
  // (each a paragraph's worth of text) as sibling blocks: the first segment continues the
  // original block, any middle segments become their own paragraphs, and the last segment
  // is joined with the split-off tail. Assumes the split point sits in a block element with
  // a single trailing text node (true for authored and unmarked paragraphs); trailing
  // inline siblings, if any, stay in the original block.
  private insertBlocks(
    targetNode: Y.XmlText,
    localOffset: number,
    segments: string[],
  ): void {
    const block = targetNode.parent;
    const parent = block?.parent;
    if (
      !(block instanceof Y.XmlElement) ||
      !(parent instanceof Y.XmlFragment || parent instanceof Y.XmlElement)
    ) {
      // Structure we don't expect — fall back to an inline insert rather than misplace text.
      targetNode.insert(localOffset, segments.join(BLOCK_SEPARATOR));
      return;
    }

    const blockIndex = (parent.toArray() as unknown[]).indexOf(block);
    const nodeText = String(targetNode.toString());
    const tail = nodeText.slice(localOffset);

    if (tail.length)
      targetNode.delete(localOffset, nodeText.length - localOffset);
    if (segments[0]) targetNode.insert(localOffset, segments[0]);

    const middle = segments.slice(1, -1).map((s) => this.createParagraph(s));
    const last = this.createParagraph(segments[segments.length - 1] + tail);
    parent.insert(blockIndex + 1, [...middle, last]);
  }

  // Deletes a flat character range, splitting it across every XmlText node it spans. Any
  // top-level block the delete empties is pruned, so "delete this paragraph" removes the
  // block instead of leaving a blank line (an all-empty doc keeps one empty paragraph).
  deleteText(doc: Y.Doc, start: number, length: number): void {
    const content = this.resolveWritableContent(doc);
    if (content instanceof Y.Text) {
      content.delete(start, length);
      return;
    }

    const xmlTextNodes = this.linearizeXmlText(content);
    const affectedBlocks = new Set<Y.XmlElement>();
    this.forEachXmlTextRange(
      xmlTextNodes,
      start,
      length,
      (node, from, size) => {
        node.delete(from, size);
        const block = this.topLevelBlock(content, node);
        if (block) affectedBlocks.add(block);
      },
    );

    this.pruneEmptyBlocks(content, affectedBlocks);
  }

  // Walks up from an inline node to the top-level block (direct child of the fragment)
  // that contains it, or null if it isn't nested under one.
  private topLevelBlock(
    fragment: Y.XmlFragment,
    node: Y.XmlText,
  ): Y.XmlElement | null {
    let current: Y.AbstractType<unknown> | null = node.parent;
    while (current && current.parent && current.parent !== fragment) {
      current = current.parent;
    }
    return current instanceof Y.XmlElement && current.parent === fragment
      ? current
      : null;
  }

  // Removes blocks the delete emptied, keeping at least one block so the document is never
  // an empty fragment (which can't hydrate — an empty ProseMirror doc is one <paragraph>).
  // Only the blocks the delete touched are considered, so intentionally-empty blocks
  // elsewhere are left untouched.
  private pruneEmptyBlocks(
    fragment: Y.XmlFragment,
    affectedBlocks: Set<Y.XmlElement>,
  ): void {
    for (const block of affectedBlocks) {
      if (fragment.length <= 1) break;
      if (!this.blockIsEmpty(block)) continue;
      const index = (fragment.toArray() as unknown[]).indexOf(block);
      if (index >= 0) fragment.delete(index, 1);
    }
  }

  // True when a block holds no text. Launders through `unknown` so the value narrows to
  // Y.AbstractType (Yjs's XML types aren't directly assignable to AbstractType<unknown>).
  private blockIsEmpty(block: Y.XmlElement): boolean {
    const node: unknown = block;
    return node instanceof Y.AbstractType
      ? this.extractInlineText(node) === ''
      : true;
  }

  // Applies formatting marks (bold, italic, …) to a flat character range across every
  // XmlText node it spans.
  formatText(
    doc: Y.Doc,
    start: number,
    length: number,
    attributes: Record<string, unknown>,
  ): void {
    const content = this.resolveWritableContent(doc);
    if (content instanceof Y.Text) {
      content.format(start, length, attributes);
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

  // Decodes a binary update into a human-readable summary of its structs and delete set,
  // used for operation logging/debugging.
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

    // Priority matters: a diff produced by encodeStateAsUpdate (how AI edits are encoded)
    // always carries the doc's FULL delete set, so a pure format op co-travels with
    // historical tombstones and hasDeletes is true even though nothing new was deleted.
    // Classify by the meaningful new structs first (insert, then format) and only fall
    // back to "delete" when the update introduces no structs of its own — otherwise every
    // AI format op would be mislabeled as a delete.
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

  // Joins each top-level block's inline text with a blank line, so the flat string mirrors
  // the document's paragraph structure (block breaks become visible to the AI).
  private extractFragmentText(fragment: Y.XmlFragment): string {
    return (fragment.toArray() as unknown[])
      .map((child) =>
        child instanceof Y.AbstractType ? this.extractInlineText(child) : '',
      )
      .join(BLOCK_SEPARATOR);
  }

  // Concatenates all text inside a single block, recursing through inline elements.
  private extractInlineText(type: Y.AbstractType<unknown>): string {
    if (type instanceof Y.XmlText) {
      return String(type.toString());
    }

    if (type instanceof Y.XmlElement || type instanceof Y.XmlFragment) {
      return (type.toArray() as unknown[])
        .map((child) =>
          child instanceof Y.AbstractType ? this.extractInlineText(child) : '',
        )
        .join('');
    }

    return '';
  }

  // Peeks the shared 'content' type from doc.share without materializing it (the public
  // getters would assign a concrete constructor as a side effect).
  private getExistingContentType(doc: Y.Doc): Y.AbstractType<unknown> | null {
    return (
      (
        doc as unknown as { share: Map<string, Y.AbstractType<unknown>> }
      ).share.get('content') ?? null
    );
  }

  // Flattens an XmlFragment's nested XmlText nodes into a list carrying each node's
  // absolute start/end offset, so a flat character position can be mapped back to the
  // node that owns it. Reserves BLOCK_SEPARATOR.length of virtual offset between
  // top-level blocks so these offsets line up exactly with extractText's output.
  private linearizeXmlText(fragment: Y.XmlFragment): LinearXmlText[] {
    const nodes: LinearXmlText[] = [];
    let offset = 0;

    (fragment.toArray() as unknown[]).forEach((child, index) => {
      if (index > 0) offset += BLOCK_SEPARATOR.length;
      if (child instanceof Y.AbstractType) {
        offset = this.collectXmlText(child, offset, nodes);
      }
    });

    return nodes;
  }

  // Appends every XmlText under `type` to `nodes` with absolute offsets, returning the
  // offset just past the collected text.
  private collectXmlText(
    type: Y.AbstractType<unknown>,
    offset: number,
    nodes: LinearXmlText[],
  ): number {
    if (type instanceof Y.XmlText) {
      const length = String(type.toString()).length;
      nodes.push({ node: type, start: offset, end: offset + length });
      return offset + length;
    }

    if (type instanceof Y.XmlElement) {
      for (const child of type.toArray() as unknown[]) {
        if (child instanceof Y.AbstractType) {
          offset = this.collectXmlText(child, offset, nodes);
        }
      }
    }

    return offset;
  }

  // Runs callback for each XmlText node overlapping the flat range [start, start+length),
  // translating the overlap into that node's local coordinates.
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
