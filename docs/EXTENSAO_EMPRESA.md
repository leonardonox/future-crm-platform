# Guia de entrega - Future CRM

## O que está pronto

- Extensão Chrome Manifest V3 para GoHighLevel/LeadConnector.
- API FastAPI com PostgreSQL.
- Login com JWT.
- Painel administrativo em `/panel`.
- Cadastro, edição e desativação de usuários.
- Categorias pessoais e categorias da empresa.
- Respostas pessoais e respostas globais da empresa.
- Permissão por perfil: `admin` e `agent`.
- Favoritos por usuário.
- Busca, filtro por categoria e filtro de favoritas na extensão.
- Cache local das últimas respostas sincronizadas.
- Registro de uso quando uma resposta é inserida.
- Endpoint `/api/setup/dev` bloqueado fora de `ENV=dev`.

## Como rodar localmente

1. Abra o Docker Desktop.

2. Na pasta do projeto, rode:

```bash
docker compose up -d
```

3. Crie o usuário inicial:

```text
http://localhost:8000/api/setup/dev
```

4. Abra o painel admin:

```text
http://localhost:8000/panel/
```

Login local:

```text
admin@future.local
123456
```

5. Instale a extensão:

- Abra `chrome://extensions/`.
- Ative o modo de desenvolvedor.
- Clique em `Carregar sem compactação`.
- Selecione a pasta `extension`.
- Abra o GoHighLevel ou LeadConnector.
- Clique em `⚡ Future`.
- Use a API `http://localhost:8000/api`.

## Como passar para o pessoal

Para teste interno rápido, envie a pasta `extension` e peça para cada pessoa carregar em `chrome://extensions/`.

Para uso definitivo, publique a API com HTTPS e use a URL final no login da extensão, por exemplo:

```text
https://api.suaempresa.com/api
```

Depois, empacote a extensão ou publique como extensão privada da empresa.

## Deploy no Render

O projeto já possui `render.yaml` na raiz. O caminho mais simples é criar um Blueprint no Render apontando para o repositório GitHub deste projeto.

O Render vai criar:

- Web Service: `future-crm-api`
- PostgreSQL: `future-crm-db`
- Variáveis automáticas: `DATABASE_URL`, `SECRET_KEY` e `SETUP_TOKEN`

Se o Render mostrar `cannot have more than one active free tier database`, sua conta já tem outro PostgreSQL gratuito ativo. Nesse caso há duas opções:

1. Apagar o banco gratuito antigo no Render e rodar o Blueprint normal com `render.yaml`.
2. Usar um PostgreSQL já existente e criar o Blueprint com `render-web-only.yaml`. Nesse modo, preencha manualmente a variável `DATABASE_URL` no serviço `future-crm-api`.

Depois do deploy, a API ficará em uma URL parecida com:

```text
https://future-crm-api.onrender.com
```

O painel ficará em:

```text
https://future-crm-api.onrender.com/panel/
```

Na extensão, use:

```text
https://future-crm-api.onrender.com/api
```

## Primeiro admin em produção

Em `ENV=prod`, o endpoint `/api/setup/dev` fica bloqueado. Para criar o primeiro admin, use o `SETUP_TOKEN` que o Render gerou nas variáveis do Web Service.

Faça uma requisição `POST` para:

```text
https://future-crm-api.onrender.com/api/setup/first-admin
```

Corpo JSON:

```json
{
  "setup_token": "COLE_O_SETUP_TOKEN_AQUI",
  "name": "Admin Future",
  "email": "admin@suaempresa.com",
  "password": "senha-forte-aqui"
}
```

Esse endpoint só funciona se ainda não existir nenhum usuário cadastrado.

## Variáveis suportadas nas mensagens

A extensão substitui automaticamente:

- `{{nome}}`
- `{{email}}`
- `{{telefone}}`
- `{{revista}}`
- `{{valor}}`
- `{{doi}}`
- `{{link}}`

As variáveis `nome`, `email` e `telefone` tentam ser lidas da tela atual do contato no GHL. As demais ficam vazias por enquanto se não houver integração específica.

## Pontos de produção

- Trocar `SECRET_KEY` por uma chave forte.
- Definir `ENV=prod`.
- Usar banco PostgreSQL persistente.
- Colocar API atrás de HTTPS.
- Remover ou bloquear qualquer acesso público ao banco.
- Criar backups do PostgreSQL.
- Validar o domínio real da API no `manifest.json`.
