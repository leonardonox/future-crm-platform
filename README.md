# Future CRM Platform

Sistema interno para mensagens rápidas no GoHighLevel com extensão Chrome + API FastAPI + PostgreSQL.

## Como rodar localmente

### 1. Instalar Docker Desktop
No Windows, instale o Docker Desktop e abra ele antes de continuar.

### 2. Subir API e banco
Na pasta do projeto:

```bash
docker compose up -d
```

A API ficará em:

```text
http://localhost:8000
```

Documentação da API:

```text
http://localhost:8000/docs
```

Painel administrativo:

```text
http://localhost:8000/panel/
```

### 3. Criar usuário inicial
Acesse no navegador:

```text
http://localhost:8000/api/setup/dev
```

Login inicial:

```text
admin@future.local
123456
```

### 4. Instalar extensão
1. Abra `chrome://extensions/`.
2. Ative **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação**.
4. Selecione a pasta `extension`.
5. Abra o GHL.
6. Clique no botão **⚡ Future**.
7. Use a API `http://localhost:8000/api`.
8. Entre com o login inicial.

## Estrutura

```text
backend/     API FastAPI
extension/   Extensão Chrome Manifest V3
panel/       Painel administrativo
docs/        Documentação técnica
```

## Produção

Para usar na empresa, suba a API e o PostgreSQL no Render usando o `render.yaml` da raiz. Depois use a URL pública da API na tela de login da extensão.

Guia completo:

```text
docs/EXTENSAO_EMPRESA.md
```
