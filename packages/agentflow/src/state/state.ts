import { md } from "../markdown/index.js";
import { Message, State } from "./state.types.js";

export class StateManager {
  state: State = {
    history: [],
    tasks: [],
    memory: [],
  };

  get history() {
    return this.state.history;
  }

  get tasks() {
    return this.state.tasks;
  }

  get memory() {
    return this.state.memory;
  }

  get(key: keyof State) {
    return this.state[key];
  }

  /**
   * Troca um bucket inteiro. Genérico por chave, e não `any`: é o que faz
   * `set("tasks", [msg])` parar de compilar — antes o tipo do valor não tinha
   * nenhuma relação com a chave, e o erro só aparecia como comportamento
   * estranho na projeção do prompt.
   */
  set<K extends keyof State>(key: K, value: State[K]): void {
    this.state[key] = value;
  }

  /** Acrescenta um item ao bucket. O tipo do item vem da chave. */
  append<K extends keyof State>(key: K, value: State[K][number]): void {
    const list = this.state[key];

    if (!Array.isArray(list)) {
      throw new Error(
        `[thena] StateManager.append("${key}"): that bucket is not an array. ` +
          `The state has three buckets — history, tasks and memory — and all ` +
          `three are arrays. Something replaced this one, most likely by ` +
          `assigning to \`state.state\` directly.`,
      );
    }

    // `State[K]` é a união `Message[] | string[]`, e o TypeScript não aceita
    // `push` de um item da união num array da união. A chave já amarrou os dois
    // na assinatura, então o estreitamento aqui é seguro.
    (list as State[K][number][]).push(value);
  }

  /**
   * Projeta os buckets nos roles que o modelo entende (o "merge"):
   *  - memory + tasks → uma mensagem `system` (durável / lembrete);
   *  - history        → os turnos user/assistant/tool como estão.
   * O autor pode ignorar este default e montar as mensagens na mão.
   */
  toMessages(): Message[] {
    const system: string[] = [];

    if (this.memory.length) {
      system.push(this.memory.join("\n"));
    }
    if (this.tasks.length) {
      system.push("Tasks:\n" + this.tasks.map((t) => `- ${t}`).join("\n"));
    }

    const messages: Message[] = [];
    if (system.length) {
      messages.push({ role: "system", content: system.join("\n\n") });
    }
    messages.push(...this.history);

    return messages;
  }

  compile(key: keyof State): string {
    const value = this.state[key];
    const { headers, lists, misc } = md;
    // Renderiza cada item: strings direto, mensagens como "role: content".
    const items = (value as unknown[]).map((item) =>
      typeof item === "string"
        ? item
        : `${(item as Message).role}: ${(item as Message).content}`,
    );
    // Generate markdown representation of the state
    const markdown = [headers.h2(key.toUpperCase()), lists.ul(items), misc.hr()].join(
      "\n",
    );

    return markdown;
  }
}
