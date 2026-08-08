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

  set(key: keyof State, value: any) {
    this.state[key] = value;
  }

  append(key: keyof State, value: any) {
    const list = this.state[key];

    if (!Array.isArray(list)) {
      throw new Error("State is not an array.");
    }

    list.push(value);
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
      system.push("Tarefas:\n" + this.tasks.map((t) => `- ${t}`).join("\n"));
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
