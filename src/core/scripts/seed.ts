import bcrypt from "bcryptjs";
import { ulid } from "ulid";
import db from "@models/index";
import type { Schema } from "@/models/schemas/index";
import { VALUE_CODECS } from "@/services/value-codec";
import { slugify } from "@/utils/slugify";

/**
 * Seed do Cub's — popula a base com dados reais/realistas do IFC:
 *
 *  - Docentes públicos do IFC Blumenau (Informática) e IFC Videira (Ciência
 *    da Computação) como `users` com senha padrão (ver .env.seed, fora do git).
 *    Fontes (públicas): informatica.blumenau.ifc.edu.br/corpo-docente/
 *                       videira.ifc.edu.br/ciencia-da-computacao/corpo-docente/
 *  - Workspaces/páginas por uso: professores por campus, turmas e fábrica de
 *    software — cada uma com colunas e valores nos tipos suportados.
 *
 * IDEMPOTENTE: cada ensure* busca antes de criar — rodar de novo não duplica.
 * Execução: npm run seed (exige SEED_USER_PASSWORD via .env.seed).
 */

// --- Dados públicos: docentes por campus ---

interface SeedProfessor {
  name: string;
  email: string;
}

const BLUMENAU_PROFESSORS: SeedProfessor[] = [
  { name: "Aldelir Fernando Luiz", email: "aldelir.luiz@ifc.edu.br" },
  { name: "Alexandre Veloso dos Santos", email: "alexandre.santos@ifc.edu.br" },
  { name: "Anderson Nereu Galcowski", email: "anderson.galcowski@ifc.edu.br" },
  { name: "André Marsiglia Quaranta", email: "andre.quaranta@ifc.edu.br" },
  { name: "Carlos Eduardo Bencke", email: "carlos.bencke@ifc.edu.br" },
  { name: "Cássia Aline Schuck", email: "cassia.schuck@ifc.edu.br" },
  { name: "Cintia Passos", email: "cintia.passos@ifc.edu.br" },
  { name: "Claudia Zimmer de Oliveira Cezar", email: "claudia.cezar@ifc.edu.br" },
  { name: "Cloves Alexandre de Castro", email: "cloves.castro@ifc.edu.br" },
  { name: "Dalton Luiz De Menezes Reis", email: "dalton.reis@ifc.edu.br" },
  { name: "Daniel Minuzzi de Souza", email: "daniel.souza@ifc.edu.br" },
  { name: "Eder Augusto Penharbel", email: "eder.penharbel@ifc.edu.br" },
  { name: "Fani Lúcia Martendal Eberhardt", email: "fani.eberhardt@ifc.edu.br" },
  { name: "Helenice Nazaré da Cunha Silva", email: "helenice.silva@ifc.edu.br" },
  { name: "Hélvio Silvester Andrade de Sousa", email: "helvio.sousa@ifc.edu.br" },
  { name: "Hylson Vescovi Netto", email: "hylson.vescovi@ifc.edu.br" },
  { name: "Jeovani Schmitt", email: "jeovani.schmitt@ifc.edu.br" },
  { name: "Karla Weber", email: "karla.weber@ifc.edu.br" },
  { name: "Karlan Rau", email: "karlan.rau@ifc.edu.br" },
  { name: "Luiz Ricardo Uriarte", email: "luiz.uriarte@ifc.edu.br" },
  { name: "Marcelo Cordeiro do Nascimento", email: "marcelo.nascimento@ifc.edu.br" },
  { name: "Paulo Cesar Rodacki Gomes", email: "paulo.gomes@ifc.edu.br" },
  { name: "Péricles Rocha da Silva", email: "pericles.silva@ifc.edu.br" },
  { name: "Ríad Mattos Nassiffe", email: "riad.nassiffe@ifc.edu.br" },
  // Nome derivado do email (a página lista só "Professor de Informática").
  { name: "Ricardo Ladeira", email: "ricardo.ladeira@ifc.edu.br" },
  { name: "Rudimar Antonio Camargo Drey", email: "rudimar.drey@ifc.edu.br" },
];

const VIDEIRA_PROFESSORS: SeedProfessor[] = [
  { name: "Angelita Zanella", email: "angelita.zanella@ifc.edu.br" },
  { name: "Carlos Roberto da Silva", email: "carlos.silva@ifc.edu.br" },
  { name: "Cíntia Fernandes Da Silva", email: "cintia.silva@ifc.edu.br" },
  { name: "Dani Prestini", email: "dani.prestini@ifc.edu.br" },
  { name: "Diego Ricardo Krohl", email: "diego.krohl@ifc.edu.br" },
  { name: "Fábio José Rodrigues Pinheiro", email: "fabio.pinheiro@ifc.edu.br" },
  { name: "Fabrício Bizotto", email: "fabricio.bizotto@ifc.edu.br" },
  { name: "Fernanda Zanotti", email: "fernanda.zanotti@ifc.edu.br" },
  { name: "Frederico De Oliveira Santos", email: "frederico.santos@ifc.edu.br" },
  { name: "Grazielle Vieira Garcia", email: "grazielle.garcia@ifc.edu.br" },
  { name: "Leila Lisiane Rossi", email: "leila.rossi@ifc.edu.br" },
  { name: "Lucilene Dal Medico Baerle", email: "lucilene.baerle@ifc.edu.br" },
  { name: "Manassés Ribeiro", email: "manasses.ribeiro@ifc.edu.br" },
  { name: "Márcia Elizabete Schuler", email: "marcia.schuler@ifc.edu.br" },
  { name: "Mariah Rausch Pereira", email: "mariah.pereira@ifc.edu.br" },
  { name: "Nadir Paula Da Rosa", email: "nadir.rosa@ifc.edu.br" },
  { name: "Pablo Andres Reyes Meyer", email: "pablo.meyer@ifc.edu.br" },
  { name: "Rafael Antônio Zanin", email: "rafael.zanin@ifc.edu.br" },
  { name: "Rosângela Aguiar Adam", email: "rosangela.adam@ifc.edu.br" },
  { name: "Sergio Fernando Maciel Correa", email: "sergio.correa@ifc.edu.br" },
  { name: "Tiago Heineck", email: "tiago.heineck@ifc.edu.br" },
  { name: "Tiago Lopes Gonçalves", email: "tiago.goncalves@ifc.edu.br" },
  { name: "Wanderson Rigo", email: "wanderson.rigo@ifc.edu.br" },
];

// --- Helpers idempotentes (buscam antes de criar) ---

const stats = { created: 0, skipped: 0 };

function track<T>(created: T | null, label: string): T {
  if (!created) throw new Error(`Seed: falha ao criar ${label}`);
  stats.created += 1;
  return created;
}

async function ensureUser(
  name: string,
  email: string,
  password_hash: string,
): Promise<Schema.User> {
  const existing = await db.users.find({ email } as LookupValues<Schema.User>);
  if (existing) {
    stats.skipped += 1;
    return existing;
  }

  const created = await db.users.create(
    { name, email, password_hash } as unknown as CreateValues<Schema.User>,
  );
  return track(created, `user ${email}`);
}

/** Workspace + page_root (id da root == id da workspace, premissa do projeto). */
async function ensureWorkspaceWithRoot(
  name: string,
  ownerId: string,
): Promise<{ workspace: Schema.Workspace; root: Schema.Page }> {
  let workspace = await db.workspaces.find({ name } as LookupValues<Schema.Workspace>);
  if (workspace) {
    stats.skipped += 1;
  } else {
    workspace = track(
      await db.workspaces.create({ name, data: {} } as unknown as CreateValues<Schema.Workspace>),
      `workspace ${name}`,
    );
  }

  let root = await db.pages.find({ id: workspace.id } as LookupValues<Schema.Page>);
  if (root) {
    stats.skipped += 1;
  } else {
    root = track(
      await db.pages.create({
        id: workspace.id,
        title: name,
        owner_id: ownerId,
        data: {},
      } as unknown as CreateValues<Schema.Page>),
      `page_root ${name}`,
    );
  }

  return { workspace, root };
}

async function ensureColumn(
  rootId: string,
  name: string,
  type: Schema.ColumnType,
  data: Schema.PageColumnData = {},
): Promise<Schema.PageColumn> {
  const existing = await db.pageColumns.find(
    { name, page_root_id: rootId } as LookupValues<Schema.PageColumn>,
  );
  if (existing) {
    stats.skipped += 1;
    return existing;
  }

  const created = await db.pageColumns.create(
    { name, type, data, page_root_id: rootId } as unknown as CreateValues<Schema.PageColumn>,
  );
  return track(created, `coluna ${name}`);
}

/** Página-filha + aresta em page_edges (UNIQUE parent_id+child_id). */
async function ensureChildPage(
  rootId: string,
  title: string,
  ownerId: string,
): Promise<Schema.Page> {
  let page = await db.pages.find({ title, owner_id: ownerId } as LookupValues<Schema.Page>);
  if (page) {
    stats.skipped += 1;
  } else {
    page = track(
      await db.pages.create({
        title,
        owner_id: ownerId,
        data: {},
      } as unknown as CreateValues<Schema.Page>),
      `página ${title}`,
    );
  }

  const edge = await db.pageEdges.find(
    { parent_id: rootId, child_id: page.id } as LookupValues<Schema.PageEdge>,
  );
  if (edge) {
    stats.skipped += 1;
  } else {
    track(
      await db.pageEdges.create({
        parent_id: rootId,
        child_id: page.id,
        slug: slugify(title),
      } as unknown as CreateValues<Schema.PageEdge>),
      `edge ${title}`,
    );
  }

  return page;
}

/** Valor de célula via VALUE_CODECS (valida + envelopa como as rotas fazem). */
async function ensureValue(
  page: Schema.Page,
  column: Schema.PageColumn,
  rawValue: unknown,
): Promise<void> {
  const existing = await db.pageColumnValues.find(
    { page_id: page.id, page_column_id: column.id } as LookupValues<Schema.PageColumnValue>,
  );
  if (existing) {
    stats.skipped += 1;
    return;
  }

  const codec = VALUE_CODECS[column.type];
  const encoded = codec.encode(codec.validate(rawValue, column));

  track(
    await db.pageColumnValues.create({
      data: encoded,
      page_id: page.id,
      page_column_id: column.id,
    } as unknown as CreateValues<Schema.PageColumnValue>),
    `valor ${column.name} de ${page.title}`,
  );
}

/** Acha o id da option de um select pelo texto (as options nascem com ULID). */
function optionId(column: Schema.PageColumn, value: string): string {
  const option = (column.data?.options ?? []).find((opt) => opt.value === value);
  if (!option) throw new Error(`Seed: option "${value}" não existe na coluna ${column.name}`);
  return option.id;
}

const iso = (date: string) => `${date}T00:00:00.000Z`;

/** Option de select com ULID novo (id é NonEmptyString branded no schema). */
const option = (value: string, color: Schema.ColorOptions): Schema.SelectOption => ({
  id: ulid() as NonEmptyString,
  value,
  color,
});

// --- Fluxo principal ---

async function main(): Promise<void> {
  const password = process.env.SEED_USER_PASSWORD;
  if (!password) {
    throw new Error(
      "SEED_USER_PASSWORD não definida — crie o .env.seed (fora do git) com a senha documentada.",
    );
  }

  // Mesma senha documentada para todos os usuários seed; hash único reutilizado.
  const passwordHash = await bcrypt.hash(password, 10);

  // Dono das páginas seed: conta administrativa FICTÍCIA (domínio .local).
  // Sem apóstrofo no nome: o SQLBuilder atual não escapa "'" (bug conhecido).
  const admin = await ensureUser("Coordenação Cubs", "admin@cubs.local", passwordHash);

  // 1. Professores como usuários (login com a senha do .env.seed).
  for (const professor of [...BLUMENAU_PROFESSORS, ...VIDEIRA_PROFESSORS]) {
    await ensureUser(professor.name, professor.email, passwordHash);
  }

  // 2. Workspace de professores por campus: linhas = docentes.
  const campi: Array<{ workspaceName: string; area: string; professors: SeedProfessor[] }> = [
    {
      workspaceName: "IFC Blumenau — Professores",
      area: "Informática",
      professors: BLUMENAU_PROFESSORS,
    },
    {
      workspaceName: "IFC Videira — Professores",
      area: "Ciência da Computação",
      professors: VIDEIRA_PROFESSORS,
    },
  ];

  for (const campus of campi) {
    const { root } = await ensureWorkspaceWithRoot(campus.workspaceName, admin.id);

    const emailColumn = await ensureColumn(root.id, "E-mail", "text");
    const areaColumn = await ensureColumn(root.id, "Área", "select", {
      options: [
        option("Informática", "blue"),
        option("Ciência da Computação", "orange"),
        option("Pedagogia", "green"),
        option("Administração", "grey"),
      ],
    });
    const activeColumn = await ensureColumn(root.id, "Ativo", "checkbox");

    for (const professor of campus.professors) {
      const page = await ensureChildPage(root.id, professor.name, admin.id);
      await ensureValue(page, emailColumn, professor.email);
      await ensureValue(page, areaColumn, optionId(areaColumn, campus.area));
      await ensureValue(page, activeColumn, true);
    }
  }

  // 3. Turmas (alunos por turma — sem dados pessoais de alunos, que não são
  //    públicos como os contatos institucionais dos docentes).
  const { root: turmasRoot } = await ensureWorkspaceWithRoot("IFC — Turmas", admin.id);
  const cursoColumn = await ensureColumn(turmasRoot.id, "Curso", "text");
  const campusColumn = await ensureColumn(turmasRoot.id, "Campus", "select", {
    options: [option("Blumenau", "blue"), option("Videira", "orange")],
  });
  const inicioColumn = await ensureColumn(turmasRoot.id, "Início", "date");
  const ativaColumn = await ensureColumn(turmasRoot.id, "Ativa", "checkbox");

  const turmas = [
    { title: "INFO2026A", curso: "Técnico em Informática Integrado", campus: "Blumenau", inicio: "2026-02-09" },
    { title: "INFO2026B", curso: "Técnico em Informática Integrado", campus: "Blumenau", inicio: "2026-02-09" },
    { title: "BCC2026", curso: "Bacharelado em Ciência da Computação", campus: "Videira", inicio: "2026-02-16" },
    { title: "PED2026", curso: "Licenciatura em Pedagogia", campus: "Blumenau", inicio: "2026-02-16" },
  ];

  for (const turma of turmas) {
    const page = await ensureChildPage(turmasRoot.id, turma.title, admin.id);
    await ensureValue(page, cursoColumn, turma.curso);
    await ensureValue(page, campusColumn, optionId(campusColumn, turma.campus));
    await ensureValue(page, inicioColumn, iso(turma.inicio));
    await ensureValue(page, ativaColumn, true);
  }

  // 4. Fábrica de Software: projetos como linhas.
  const { root: fabricaRoot } = await ensureWorkspaceWithRoot("Fábrica de Software", admin.id);
  const statusColumn = await ensureColumn(fabricaRoot.id, "Status", "select", {
    options: [
      option("Backlog", "grey"),
      option("Em andamento", "yellow"),
      option("Concluído", "green"),
    ],
  });
  const responsavelColumn = await ensureColumn(fabricaRoot.id, "Responsável", "text");
  const entregaColumn = await ensureColumn(fabricaRoot.id, "Entrega", "date");
  const progressoColumn = await ensureColumn(fabricaRoot.id, "Progresso", "numeric", {
    format: "percentage",
  });

  const projetos = [
    {
      title: "Cubs — Backend (API + realtime)",
      status: "Em andamento",
      responsavel: "Helder Martins",
      entrega: iso("2026-08-31"),
      progresso: 80,
    },
    {
      title: "Cubs — Searchbar do frontend",
      status: "Backlog",
      responsavel: "Helder Martins",
      entrega: `${iso("2026-07-20")}@${iso("2026-08-15")}`,
      progresso: 0,
    },
    {
      title: "Portal de Estágios",
      status: "Backlog",
      responsavel: "Fábrica de Software",
      entrega: iso("2026-11-30"),
      progresso: 0,
    },
    {
      title: "Seed IFC (base de demonstração)",
      status: "Concluído",
      responsavel: "Fábrica de Software",
      entrega: iso("2026-07-13"),
      progresso: 100,
    },
  ];

  for (const projeto of projetos) {
    const page = await ensureChildPage(fabricaRoot.id, projeto.title, admin.id);
    await ensureValue(page, statusColumn, optionId(statusColumn, projeto.status));
    await ensureValue(page, responsavelColumn, projeto.responsavel);
    await ensureValue(page, entregaColumn, projeto.entrega);
    await ensureValue(page, progressoColumn, projeto.progresso);
  }

  console.log(
    `[Seed] Concluído: ${stats.created} registros criados, ${stats.skipped} já existiam.`,
  );
}

main().catch((error) => {
  console.error(`[Seed] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
