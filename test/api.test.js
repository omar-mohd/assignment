import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from 'docx';
import { createApp } from '../server/app.js';
import { createDb, DEMO_PASSWORD } from '../server/db.js';

let db, app;
const agents = {};

async function signIn(name) {
  const agent = request.agent(app);
  await agent
    .post('/api/auth/login')
    .send({ email: `${name}@ajaia.test`, password: DEMO_PASSWORD })
    .expect(200);
  return agent;
}

beforeAll(async () => {
  db = await createDb(); // in-memory PGlite, seeded with alice/bob/carol
  app = createApp({ db, secret: 'test-secret' });
  for (const n of ['alice', 'bob', 'carol']) agents[n] = await signIn(n);
});
afterAll(() => db.close());

describe('auth', () => {
  it('rejects bad credentials and unauthenticated requests', async () => {
    await request(app).post('/api/auth/login').send({ email: 'alice@ajaia.test', password: 'nope' }).expect(401);
    await request(app).get('/api/documents').expect(401);
  });
});

describe('documents', () => {
  it('creates, renames, saves and reopens with formatting preserved (and unsafe HTML stripped)', async () => {
    const { alice } = agents;
    const created = await alice.post('/api/documents').send({}).expect(201);
    const { id, version } = created.body.document;
    expect(created.body.document.title).toBe('Untitled document');

    const html =
      '<h2>Plan</h2><p><strong>Bold</strong> <em>it</em> <u>u</u></p><ul><li><p>one</p></li></ul><script>alert(1)</script>';
    const saved = await alice
      .patch(`/api/documents/${id}`)
      .send({ title: 'Roadmap', content: html, version })
      .expect(200);
    expect(saved.body.document.version).toBe(version + 1);

    const reopened = await alice.get(`/api/documents/${id}`).expect(200);
    expect(reopened.body.document.title).toBe('Roadmap');
    expect(reopened.body.document.content).toContain('<h2>Plan</h2>');
    expect(reopened.body.document.content).toContain('<u>u</u>');
    expect(reopened.body.document.content).not.toContain('script');
  });

  it('validates input', async () => {
    const { alice } = agents;
    const { body } = await alice.post('/api/documents').send({}).expect(201);
    const res = await alice.patch(`/api/documents/${body.document.id}`).send({ title: '   ', version: 1 }).expect(400);
    expect(res.body.error.message).toMatch(/empty/i);
    await alice.patch(`/api/documents/${body.document.id}`).send({ version: 1 }).expect(400);
  });

  it('rejects stale writes with 409 instead of silently overwriting', async () => {
    const { alice, bob } = agents;
    const { body } = await alice.post('/api/documents').send({ title: 'Shared draft' }).expect(201);
    const doc = body.document;
    await alice.post(`/api/documents/${doc.id}/shares`).send({ email: 'bob@ajaia.test', role: 'editor' }).expect(200);

    await bob
      .patch(`/api/documents/${doc.id}`)
      .send({ content: '<p>Bob was here</p>', version: doc.version })
      .expect(200);
    const stale = await alice
      .patch(`/api/documents/${doc.id}`)
      .send({ content: '<p>Alice</p>', version: doc.version })
      .expect(409);
    expect(stale.body.error.document.content).toContain('Bob was here');
  });
});

describe('sharing and access control', () => {
  let docId;
  beforeAll(async () => {
    const { body } = await agents.alice
      .post('/api/documents')
      .send({ title: 'Private memo', content: '<p>secret</p>' });
    docId = body.document.id;
  });

  it('hides documents from users without access', async () => {
    await agents.bob.get(`/api/documents/${docId}`).expect(404);
    const list = await agents.bob.get('/api/documents').expect(200);
    expect(list.body.shared.map((d) => d.id)).not.toContain(docId);
  });

  it('lets the owner grant viewer access; viewer can read but not edit or reshare', async () => {
    const { alice, carol } = agents;
    const shared = await alice
      .post(`/api/documents/${docId}/shares`)
      .send({ email: 'carol@ajaia.test', role: 'viewer' })
      .expect(200);
    expect(shared.body.shares).toEqual([expect.objectContaining({ email: 'carol@ajaia.test', role: 'viewer' })]);

    const list = await carol.get('/api/documents').expect(200);
    expect(list.body.shared).toContainEqual(
      expect.objectContaining({ id: docId, role: 'viewer', owner_name: 'Alice Owner' }),
    );
    expect(list.body.owned.map((d) => d.id)).not.toContain(docId);

    const doc = await carol.get(`/api/documents/${docId}`).expect(200);
    expect(doc.body.document.role).toBe('viewer');
    expect(doc.body.shares).toBeUndefined(); // only owners see the share list
    await carol
      .patch(`/api/documents/${docId}`)
      .send({ content: '<p>hack</p>', version: doc.body.document.version })
      .expect(403);
    await carol.post(`/api/documents/${docId}/shares`).send({ email: 'bob@ajaia.test', role: 'editor' }).expect(403);
    await carol.delete(`/api/documents/${docId}`).expect(403);
  });

  it('upgrades a role, revokes access, and rejects unknown users / self-shares', async () => {
    const { alice, carol } = agents;
    await alice.post(`/api/documents/${docId}/shares`).send({ email: 'carol@ajaia.test', role: 'editor' }).expect(200);
    expect((await carol.get(`/api/documents/${docId}`)).body.document.role).toBe('editor');

    const carolId = (await carol.get('/api/auth/me')).body.user.id;
    await alice.delete(`/api/documents/${docId}/shares/${carolId}`).expect(200);
    await carol.get(`/api/documents/${docId}`).expect(404);

    await alice.post(`/api/documents/${docId}/shares`).send({ email: 'ghost@ajaia.test', role: 'viewer' }).expect(404);
    await alice.post(`/api/documents/${docId}/shares`).send({ email: 'alice@ajaia.test', role: 'viewer' }).expect(400);
  });
});

describe('file import', () => {
  it('turns a Markdown file into a formatted document named after the file', async () => {
    const md = '# Launch notes\n\nSome **bold** text.\n\n1. first\n2. second\n';
    const res = await agents.alice
      .post('/api/documents/import')
      .attach('file', Buffer.from(md), 'launch-notes.md')
      .expect(201);
    expect(res.body.document.title).toBe('launch-notes');
    expect(res.body.document.content).toContain('<h1>Launch notes</h1>');
    expect(res.body.document.content).toContain('<ol>');
    expect(res.body.document.role).toBe('owner');
  });

  it('converts .docx headings and bold text', async () => {
    const docx = new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: 'Quarterly review', heading: HeadingLevel.HEADING_1 }),
            new Paragraph({ children: [new TextRun({ text: 'Revenue up', bold: true })] }),
          ],
        },
      ],
    });
    const buffer = await Packer.toBuffer(docx);
    const res = await agents.alice.post('/api/documents/import').attach('file', buffer, 'review.docx').expect(201);
    expect(res.body.document.content).toContain('<h1>Quarterly review</h1>');
    expect(res.body.document.content).toContain('<strong>Revenue up</strong>');
  });

  it('escapes plain text and rejects unsupported, empty or corrupt files', async () => {
    const txt = await agents.alice
      .post('/api/documents/import')
      .attach('file', Buffer.from('a <b>\n\nnext'), 'n.txt')
      .expect(201);
    expect(txt.body.document.content).toBe('<p>a &lt;b&gt;</p>\n<p>next</p>');

    const bad = await agents.alice
      .post('/api/documents/import')
      .attach('file', Buffer.from('%PDF'), 'x.pdf')
      .expect(415);
    expect(bad.body.error.message).toMatch(/\.txt, \.md, \.docx/);
    await agents.alice.post('/api/documents/import').attach('file', Buffer.alloc(0), 'empty.txt').expect(400);
    await agents.alice
      .post('/api/documents/import')
      .attach('file', Buffer.from('not a zip'), 'broken.docx')
      .expect(422);
  });
});

describe('version history', () => {
  it('groups autosaves into one version per editing session and restores old versions', async () => {
    const { alice, bob } = agents;
    const { body } = await alice.post('/api/documents').send({ title: 'History', content: '<p>v1</p>' }).expect(201);
    const id = body.document.id;
    await alice.post(`/api/documents/${id}/shares`).send({ email: 'bob@ajaia.test', role: 'editor' }).expect(200);

    // Three quick saves by Alice -> folded into one version on top of "Created".
    let version = body.document.version;
    for (const text of ['a', 'ab', 'abc']) {
      version = (await alice.patch(`/api/documents/${id}`).send({ content: `<p>${text}</p>`, version })).body.document
        .version;
    }
    // A save by Bob starts a new version.
    await bob.patch(`/api/documents/${id}`).send({ content: '<p>bob</p>', version }).expect(200);

    const list = (await alice.get(`/api/documents/${id}/versions`).expect(200)).body.versions;
    expect(list.map((v) => [v.author_name, v.label])).toEqual([
      ['Bob Editor', null],
      ['Alice Owner', null],
      ['Alice Owner', 'Created'],
    ]);
    const alicesVersion = await alice.get(`/api/documents/${id}/versions/${list[1].id}`).expect(200);
    expect(alicesVersion.body.version.content).toBe('<p>abc</p>');

    const restored = await alice.post(`/api/documents/${id}/versions/${list[1].id}/restore`).expect(200);
    expect(restored.body.document.content).toBe('<p>abc</p>');
    const after = (await alice.get(`/api/documents/${id}/versions`)).body.versions;
    expect(after).toHaveLength(4);
    expect(after[0].label).toMatch(/^Restored version from/);
  });

  it('lets viewers see history but not restore, and hides it from outsiders', async () => {
    const { alice, carol, bob } = agents;
    const { body } = await alice.post('/api/documents').send({ title: 'Viewer history' }).expect(201);
    const id = body.document.id;
    await alice.post(`/api/documents/${id}/shares`).send({ email: 'carol@ajaia.test', role: 'viewer' }).expect(200);
    const [v] = (await carol.get(`/api/documents/${id}/versions`).expect(200)).body.versions;
    await carol.post(`/api/documents/${id}/versions/${v.id}/restore`).expect(403);
    await bob.get(`/api/documents/${id}/versions`).expect(404);
  });
});

describe('presence', () => {
  it('shows who else has the document open, and whether they are typing', async () => {
    const { alice, bob } = agents;
    const { body } = await alice.post('/api/documents').send({ title: 'Presence' }).expect(201);
    const id = body.document.id;
    await alice.post(`/api/documents/${id}/shares`).send({ email: 'bob@ajaia.test', role: 'editor' }).expect(200);

    const first = await alice.post(`/api/documents/${id}/presence`).send({}).expect(200);
    expect(first.body.users).toEqual([]);
    await bob.post(`/api/documents/${id}/presence`).send({ typing: true }).expect(200);
    const second = await alice.post(`/api/documents/${id}/presence`).send({}).expect(200);
    expect(second.body.users).toEqual([{ id: expect.any(Number), name: 'Bob Editor', typing: true }]);
    expect(second.body.version).toBe(body.document.version);

    await bob.delete(`/api/documents/${id}/presence`).expect(204);
    expect((await alice.post(`/api/documents/${id}/presence`).send({})).body.users).toEqual([]);
  });
});

describe('fonts', () => {
  it('keeps supported font-family spans and strips any other styling', async () => {
    const html =
      '<p><span style="font-family: Georgia">serif</span> <span style="font-family: Comic Sans MS; color: red">x</span> <span style="color: red">y</span></p>';
    const { body } = await agents.alice.post('/api/documents').send({ content: html }).expect(201);
    expect(body.document.content).toContain('<span style="font-family:Georgia">serif</span>');
    expect(body.document.content).not.toMatch(/Comic|color/);
  });
});
