/**
 * server/schemas.ts
 *
 * Owns: the JSON Schemas the model is constrained to — the outer shape of a
 * generated SiteConfig, and the edit-operation list a targeted edit returns.
 *
 * Open when: adding a block type, changing the site shape, or changing what an
 * edit is allowed to do.
 *
 * Never: describe the inside of `props`. Props stay free-form on purpose: a
 * schema for 19 block types would cost more tokens than it saves.
 */

import { blockMetadata } from '../src/lib/block-metadata'
import type { JsonSchemaSpec } from './llm'

const BLOCK_TYPES = blockMetadata.map((block) => block.type)

/**
 * Constrains only the skeleton the client already validates (name, pages,
 * blocks[].type). A model that answers with an unrelated JSON object is now
 * rejected by the provider instead of by our retry loop.
 */
export const SITE_CONFIG_SCHEMA: JsonSchemaSpec = {
  name: 'site_config',
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      theme: { type: 'object' },
      pages: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            path: { type: 'string' },
            blocks: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  type: { type: 'string', enum: BLOCK_TYPES },
                  variant: { type: 'string' },
                  props: { type: 'object' },
                  background: { type: 'object' },
                },
                required: ['type', 'props'],
              },
            },
          },
          required: ['id', 'name', 'path', 'blocks'],
        },
      },
      blocks: { type: 'array' },
    },
    required: ['name', 'pages'],
  },
}

/**
 * An edit returns operations, not a document. Keeping the op vocabulary small
 * is what makes the answer cheap and checkable.
 *
 * Each operation is its own branch so the provider knows which fields are
 * mandatory: an `insert` without an index or without props is not a valid
 * insert, and letting it through produces an empty block at the end of a page.
 */
/**
 * An edit returns operations, not a document. Keeping the op vocabulary small
 * is what makes the answer cheap and checkable.
 *
 * Flat on purpose: a `oneOf` per operation type reads better but makes this
 * model dump the whole configuration as setTheme/setPage ops, or time out.
 * Every field stays optional here and the applier validates what arrives.
 */
export const EDIT_OPS_SCHEMA: JsonSchemaSpec = {
  name: 'site_edit',
  schema: {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      ops: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            op: {
              type: 'string',
              enum: ['set', 'setVariant', 'setBackground', 'setTheme', 'setName', 'setPage', 'insert', 'remove', 'move'],
            },
            page: { type: 'string' },
            block: { type: 'string' },
            prop: { type: 'string' },
            value: {},
            color: { type: ['string', 'null'] },
            tone: { type: 'string', enum: ['auto', 'light', 'dark'] },
            index: { type: 'integer' },
            from: { type: 'integer' },
            to: { type: 'integer' },
            type: { type: 'string', enum: BLOCK_TYPES },
            variant: { type: 'string' },
            props: { type: 'object' },
            background: { type: 'object' },
          },
          required: ['op'],
        },
      },
    },
    required: ['ops'],
  },
}
