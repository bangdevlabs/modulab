/* =====================================================
   legobox-server — Servidor compartilhado do LegoBox
   Hono + Node.js, armazena JSONs em disco.
   Deploy no Render com Persistent Disk em /data.
   ===================================================== */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, unlinkSync } from 'fs'
import { join } from 'path'

const TOKEN    = process.env.LEGOBOX_TOKEN || 'dev-token'
const DATA_DIR = process.env.DATA_DIR      || './data'
const PORT     = parseInt(process.env.PORT || '3000', 10)

const KINDS = ['pieces', 'projects', 'sprites']

// Garante que os diretórios existam na inicialização
for (const kind of KINDS) {
  const dir = join(DATA_DIR, kind)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

// Previne path traversal: só permite nomes alphanumeric + _ -
const isSafeName = (name) => /^[a-zA-Z0-9_\-]{1,100}$/.test(name)
const isKind     = (k)    => KINDS.includes(k)

const app = new Hono()

app.use('*', cors())

/* ---------- Health check (Render usa pra saber se está de pé) ---------- */
app.get('/health', (c) => c.json({ ok: true }))

/* ---------- Auth middleware (apenas para escrita) ---------- */
const auth = async (c, next) => {
  if (c.req.header('Authorization') !== `Bearer ${TOKEN}`) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  await next()
}

/* ---------- Listar ---------- */
app.get('/:kind', (c) => {
  const { kind } = c.req.param()
  if (!isKind(kind)) return c.json({ error: 'kind inválido' }, 400)

  const dir   = join(DATA_DIR, kind)
  const files = existsSync(dir)
    ? readdirSync(dir).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5))
    : []
  return c.json(files)
})

/* ---------- Carregar ---------- */
app.get('/:kind/:name', (c) => {
  const { kind, name } = c.req.param()
  if (!isKind(kind))     return c.json({ error: 'kind inválido' }, 400)
  if (!isSafeName(name)) return c.json({ error: 'nome inválido' }, 400)

  const file = join(DATA_DIR, kind, `${name}.json`)
  if (!existsSync(file)) return c.json({ error: 'não encontrado' }, 404)

  return c.json(JSON.parse(readFileSync(file, 'utf-8')))
})

/* ---------- Salvar ---------- */
app.put('/:kind/:name', auth, async (c) => {
  const { kind, name } = c.req.param()
  if (!isKind(kind))     return c.json({ error: 'kind inválido' }, 400)
  if (!isSafeName(name)) return c.json({ error: 'nome inválido' }, 400)

  const data = await c.req.json()
  writeFileSync(join(DATA_DIR, kind, `${name}.json`), JSON.stringify(data, null, 2))
  return c.json({ ok: true })
})

/* ---------- Apagar ---------- */
app.delete('/:kind/:name', auth, (c) => {
  const { kind, name } = c.req.param()
  if (!isKind(kind))     return c.json({ error: 'kind inválido' }, 400)
  if (!isSafeName(name)) return c.json({ error: 'nome inválido' }, 400)

  const file = join(DATA_DIR, kind, `${name}.json`)
  if (existsSync(file)) unlinkSync(file)
  return c.json({ ok: true })
})

/* ---------- Boot ---------- */
serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`LegoBox server rodando na porta ${PORT}`)
  console.log(`DATA_DIR: ${DATA_DIR}`)
  console.log(`Token configurado: ${TOKEN !== 'dev-token' ? 'SIM' : 'NAO (usando dev-token)'}`)
})
