import express, { type Request, type Response, type NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { obterEstatisticas } from "../services/stats.js";
import {
  listarPerfumes,
  criarPerfume,
  atualizarPerfume,
  removerPerfume,
  ajustarEstoquePainel,
  marcarParaAnunciar,
  encerrarVendaManual,
} from "../services/perfumes.js";
import { registrarVendaPainel } from "../services/vendas.js";
import { obterConfiguracoes, salvarConfiguracoes } from "../services/configuracoes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function comparaSeguro(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** O painel expõe dados de vendas/estoque num endereço público (Render) —
 * protege com usuário/senha (Basic Auth) pra não ficar aberto pra qualquer um. */
function exigirAutenticacao(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? "";
  const [scheme, encoded] = header.split(" ");

  if (scheme === "Basic" && encoded) {
    const [user, pass] = Buffer.from(encoded, "base64").toString("utf-8").split(":");
    if (
      user && pass &&
      comparaSeguro(user, config.web.authUser) &&
      comparaSeguro(pass, config.web.authPassword)
    ) {
      next();
      return;
    }
  }

  res.set("WWW-Authenticate", 'Basic realm="Painel Perfume ML Bot"');
  res.status(401).send("Autenticação necessária.");
}

export function iniciarPainelAdmin(): void {
  const app = express();
  app.use(exigirAutenticacao);
  app.use(express.json());
  app.use(express.static(path.join(__dirname, "public")));

  app.get("/api/stats", async (_req, res) => {
    try {
      const stats = await obterEstatisticas();
      res.json({ stats });
    } catch (err) {
      res.status(500).json({ erro: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/perfumes", async (_req, res) => {
    try {
      const perfumes = await listarPerfumes();
      res.json({ perfumes });
    } catch (err) {
      res.status(500).json({ erro: err instanceof Error ? err.message : String(err) });
    }
  });

  /** Cria um perfume direto pelo painel (sem precisar passar pela planilha primeiro). */
  app.post("/api/perfumes", async (req, res) => {
    try {
      const perfume = await criarPerfume(req.body ?? {});
      res.json({ perfume });
    } catch (err) {
      res.status(400).json({ erro: err instanceof Error ? err.message : String(err) });
    }
  });

  /** Edita os dados cadastrais de um perfume (não mexe em estoque). */
  app.put("/api/perfumes/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ erro: "id inválido." });
      return;
    }
    try {
      const perfume = await atualizarPerfume(id, req.body ?? {});
      res.json({ perfume });
    } catch (err) {
      res.status(400).json({ erro: err instanceof Error ? err.message : String(err) });
    }
  });

  /** Remove um perfume do catálogo (só se não tiver histórico de vendas/estoque). */
  app.delete("/api/perfumes/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ erro: "id inválido." });
      return;
    }
    try {
      await removerPerfume(id);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ erro: err instanceof Error ? err.message : String(err) });
    }
  });

  /** Ajuste manual de estoque (correção/perda/achado) — não é uma venda, delta pode ser negativo. */
  app.post("/api/perfumes/:id/ajuste-estoque", async (req, res) => {
    const id = Number(req.params.id);
    const { deltaMl, motivo, anunciarDeNovo } = req.body ?? {};
    if (!Number.isFinite(id) || !Number.isFinite(Number(deltaMl))) {
      res.status(400).json({ erro: "Informe id e deltaMl válidos." });
      return;
    }
    try {
      const resultado = await ajustarEstoquePainel(
        id,
        Number(deltaMl),
        typeof motivo === "string" ? motivo : undefined,
        Boolean(anunciarDeNovo)
      );
      res.json(resultado);
    } catch (err) {
      res.status(400).json({ erro: err instanceof Error ? err.message : String(err) });
    }
  });

  /** Republica um perfume já anunciado agora mesmo — sem precisar mudar nenhum
   * dado do cadastro pra disparar isso. */
  app.post("/api/perfumes/:id/anunciar-de-novo", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ erro: "id inválido." });
      return;
    }
    try {
      const resultado = await marcarParaAnunciar(id);
      res.json(resultado);
    } catch (err) {
      res.status(400).json({ erro: err instanceof Error ? err.message : String(err) });
    }
  });

  /** Encerra a venda de um perfume na marra, independente de quanto ml ainda resta —
   * zera o estoque e manda a mensagem de fechamento normal (foto + lista de compradores)
   * pro grupo, igual a um esgotamento orgânico. */
  app.post("/api/perfumes/:id/encerrar-venda", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ erro: "id inválido." });
      return;
    }
    try {
      const resultado = await encerrarVendaManual(id);
      res.json(resultado);
    } catch (err) {
      res.status(400).json({ erro: err instanceof Error ? err.message : String(err) });
    }
  });

  /** Registra uma venda direto pelo painel: você só informa o perfume e quantos ml
   * saíram (cliente é opcional) — o valor é calculado a partir do preço/ml cadastrado. */
  app.post("/api/vendas", async (req, res) => {
    const { perfumeId, mlVendido, clienteNome } = req.body ?? {};
    if (!Number.isFinite(Number(perfumeId)) || !Number.isFinite(Number(mlVendido))) {
      res.status(400).json({ erro: "Informe perfumeId e mlVendido válidos." });
      return;
    }
    try {
      const resultado = await registrarVendaPainel({
        perfumeId: Number(perfumeId),
        mlVendido: Number(mlVendido),
        clienteNome: typeof clienteNome === "string" ? clienteNome : undefined,
      });
      res.json(resultado);
    } catch (err) {
      res.status(400).json({ erro: err instanceof Error ? err.message : String(err) });
    }
  });

  /** Configurações globais usadas no leilão do WhatsApp (chave PIX + texto de endereço). */
  app.get("/api/configuracoes", async (_req, res) => {
    try {
      const configuracoes = await obterConfiguracoes();
      res.json({ configuracoes });
    } catch (err) {
      res.status(500).json({ erro: err instanceof Error ? err.message : String(err) });
    }
  });

  app.put("/api/configuracoes", async (req, res) => {
    const { pixKey, textoEndereco, mlMinimo, assinaturaMarca, telefoneFinanceiro } = req.body ?? {};
    try {
      const configuracoes = await salvarConfiguracoes({
        pixKey: typeof pixKey === "string" ? pixKey : undefined,
        textoEndereco: typeof textoEndereco === "string" ? textoEndereco : undefined,
        mlMinimo: Number.isFinite(Number(mlMinimo)) && mlMinimo !== "" && mlMinimo !== undefined ? Number(mlMinimo) : undefined,
        assinaturaMarca: typeof assinaturaMarca === "string" ? assinaturaMarca : undefined,
        telefoneFinanceiro: typeof telefoneFinanceiro === "string" ? telefoneFinanceiro : undefined,
      });
      res.json({ configuracoes });
    } catch (err) {
      res.status(400).json({ erro: err instanceof Error ? err.message : String(err) });
    }
  });

  app.listen(config.web.port, () => {
    console.log(`Painel administrativo disponível na porta ${config.web.port}`);
  });
}
