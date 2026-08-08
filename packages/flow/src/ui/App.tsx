import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { FlowEvent, FlowRun, FlowSnapshot } from "../tipos.js";
import { buildTree, posicionar, type FlowNode } from "./grafo.js";

const ICONS: Record<string, string> = {
  workflow: "▣",
  loop: "↻",
  parallel: "⇉",
  agent: "◆",
  chat: "✦",
  tool: "⚙",
};

function StepNode({ data, selected }: NodeProps<FlowNode>) {
  return (
    <div
      className={`no no--${data.kind} no--${data.workflowState}`}
      data-selecionado={selected}
    >
      <Handle type="target" position={Position.Left} />
      <span className="no__icone">{ICONS[data.kind] ?? "•"}</span>
      <span className="no__texto">
        <strong>{data.rotulo}</strong>
        <small>
          {data.kind}
          {data.duracaoMs != null && ` · ${formatDuration(data.duracaoMs)}`}
        </small>
      </span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const NODE_TYPES = { step: StepNode };

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function formatarHora(epoch: number): string {
  return new Date(epoch).toLocaleTimeString();
}

export function App() {
  const [runs, setRuns] = useState<FlowRun[]>([]);
  const [runVisivel, setRunVisivel] = useState<string>();
  const [events, setEventos] = useState<FlowEvent[]>([]);
  const [selecionado, setSelecionado] = useState<string>();
  const [conectado, setConectado] = useState(false);

  // A run em foco fica numa ref porque o handler do SSE é registrado uma vez.
  const foco = useRef<string | undefined>(undefined);
  foco.current = runVisivel;
  // Segue a run mais nova enquanto o usuário não escolher uma antiga na lista.
  const seguindo = useRef(true);

  useEffect(() => {
    const fonte = new EventSource("/api/eventos");

    fonte.addEventListener("open", () => setConectado(true));
    fonte.addEventListener("error", () => setConectado(false));

    fonte.addEventListener("snapshot", (e) => {
      const dados: FlowSnapshot = JSON.parse((e as MessageEvent).data);
      setConectado(true);
      setRuns(dados.runs);
      setRunVisivel(dados.runAtual);
      setEventos(dados.events);
    });

    fonte.addEventListener("run", (e) => {
      const run: FlowRun = JSON.parse((e as MessageEvent).data);
      setRuns((atuais) => {
        const i = atuais.findIndex((r) => r.id === run.id);
        if (i < 0) return [run, ...atuais];
        const copia = [...atuais];
        copia[i] = run;
        return copia;
      });
      // Run nova: só pula para ela se o usuário não estiver revendo uma antiga.
      if (seguindo.current && run.steps === 0 && foco.current !== run.id) {
        foco.current = run.id;
        setRunVisivel(run.id);
        setEventos([]);
        setSelecionado(undefined);
      }
    });

    fonte.addEventListener("evento", (e) => {
      const evento: FlowEvent = JSON.parse((e as MessageEvent).data);
      if (evento.runId !== foco.current) return;
      setEventos((atuais) => [...atuais, evento]);
    });

    return () => fonte.close();
  }, []);

  const openRun = useCallback(async (run: FlowRun) => {
    seguindo.current = run.status === "rodando";
    foco.current = run.id;
    setRunVisivel(run.id);
    setSelecionado(undefined);
    const resposta = await fetch(`/api/runs/${run.id}`);
    const { events: carregados } = await resposta.json();
    // Uma corrida com o SSE aqui só aconteceria se o usuário trocasse de run
    // durante o fetch; o guard devolve o controle a quem chegou por último.
    if (foco.current === run.id) setEventos(carregados ?? []);
  }, []);

  const { nodes, edges, mapa } = useMemo(() => {
    const arvore = buildTree(events);
    return { ...posicionar(arvore), mapa: arvore };
  }, [events]);

  const detalhe = selecionado ? mapa.get(selecionado)?.dados : undefined;
  const run = runs.find((r) => r.id === runVisivel);

  return (
    <div className="app">
      <aside className="lateral">
        <header className="marca">
          <h1>Thena Flow</h1>
          <span className={`pulso ${conectado ? "pulso--vivo" : ""}`}>
            {conectado ? "ao vivo" : "desconectado"}
          </span>
        </header>

        <h2 className="lateral__titulo">Execuções</h2>
        {runs.length === 0 && (
          <p className="vazio">Nada ainda. Rode o seu workflow — ele aparece aqui.</p>
        )}
        <ul className="runs">
          {runs.map((r) => (
            <li key={r.id}>
              <button
                className={`run run--${r.status}`}
                aria-current={r.id === runVisivel}
                onClick={() => openRun(r)}
              >
                <strong>{r.name}</strong>
                <small>
                  {formatarHora(r.inicioEm)} · {r.steps} passos
                  {r.duracaoMs != null && ` · ${formatDuration(r.duracaoMs)}`}
                </small>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main className="palco">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodeClick={(_, no) => setSelecionado(no.id)}
          onPaneClick={() => setSelecionado(undefined)}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          proOptions={{ hideAttribution: false }}
        >
          <Background gap={18} size={1} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable />
        </ReactFlow>

        {run && (
          <div className="rodape">
            <strong>{run.name}</strong>
            <span className={`etiqueta etiqueta--${run.status}`}>{run.status}</span>
            {run.duracaoMs != null && <span>{formatDuration(run.duracaoMs)}</span>}
          </div>
        )}
      </main>

      {detalhe && (
        <aside className="detalhe">
          <header>
            <h2>{detalhe.rotulo}</h2>
            <button onClick={() => setSelecionado(undefined)} aria-label="fechar">
              ✕
            </button>
          </header>
          <dl>
            <dt>tipo</dt>
            <dd>{detalhe.kind}</dd>
            <dt>estado</dt>
            <dd className={`estado estado--${detalhe.workflowState}`}>
              {detalhe.workflowState}
            </dd>
            {detalhe.duracaoMs != null && (
              <>
                <dt>duração</dt>
                <dd>{formatDuration(detalhe.duracaoMs)}</dd>
              </>
            )}
          </dl>

          {detalhe.erro && <pre className="erro">{detalhe.erro}</pre>}

          {detalhe.payload &&
            Object.entries(detalhe.payload).map(([chave, valor]) => (
              <section key={chave}>
                <h3>{chave}</h3>
                <pre>
                  {typeof valor === "string" ? valor : JSON.stringify(valor, null, 2)}
                </pre>
              </section>
            ))}
        </aside>
      )}
    </div>
  );
}
