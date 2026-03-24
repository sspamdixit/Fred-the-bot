declare module "groq-sdk" {
  export interface ChatCompletionMessageParam {
    role: "system" | "user" | "assistant";
    content: string;
  }

  export interface ChatCompletionCreateParams {
    model: string;
    messages: ChatCompletionMessageParam[];
    max_tokens?: number;
    temperature?: number;
  }

  export interface ChatCompletionResponse {
    choices: Array<{
      message?: {
        content?: string;
      };
    }>;
  }

  class Groq {
    constructor(options: { apiKey: string });
    chat: {
      completions: {
        create(params: ChatCompletionCreateParams): Promise<ChatCompletionResponse>;
      };
    };
  }

  namespace Groq {
    namespace Chat {
      type ChatCompletionMessageParam = import("groq-sdk").ChatCompletionMessageParam;
    }
  }

  export default Groq;
}
