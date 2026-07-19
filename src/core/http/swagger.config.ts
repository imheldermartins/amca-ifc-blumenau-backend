import swaggerJsdoc from "swagger-jsdoc";
import { API_PREFIX } from "@/constants/api_prefix";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "API",
      version: "1.0.0",
      description: "Documentação gerada a partir dos comentários @openapi nas rotas.",
    },
    // O prefixo das rotas mora aqui, não nos @openapi: assim os comentários
    // continuam batendo com o caminho declarado no router ("/pages/{id}") e o
    // "Try it out" do swagger-ui monta a URL final ("/api/pages/{id}").
    servers: [{ url: API_PREFIX }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
  },
  // Ajuste esse glob pro caminho real do seu build (ex.: "dist/routes/*.js" em produção,
  // se as rotas compiladas perderem os comentários, gere o spec a partir do source mesmo assim).
  apis: ["src/routes/*.ts", "src/core/auth/*.ts"],
};

export const swaggerSpec = swaggerJsdoc(options);