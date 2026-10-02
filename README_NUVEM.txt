SISTEMA DE CLIENTES — VERSÃO NUVEM
==================================

O sistema foi convertido para:
- Flask
- PostgreSQL em nuvem via DATABASE_URL
- SQLite como fallback para teste local
- Gunicorn para produção
- Login e senha
- Backup JSON e exportação CSV

LOGIN LOCAL PADRÃO
------------------
Usuário: admin
Senha: troque-esta-senha
Troque a senha antes de publicar.

TESTE LOCAL NO WINDOWS
----------------------
1. Instale Python.
2. Dê dois cliques em iniciar_local.bat.
3. Abra http://localhost:5000

PUBLICAR NO RENDER
------------------
1. Coloque esta pasta em um repositório GitHub.
2. No Render, use New > Blueprint e selecione o repositório (render.yaml está pronto).
3. Quando solicitado, defina ADMIN_PASSWORD com uma senha forte.
4. O Render cria o web service e o PostgreSQL e injeta DATABASE_URL.
5. Abra a URL gerada pelo Render.

PUBLICAR NO RAILWAY
-------------------
1. Coloque esta pasta em um repositório GitHub ou use Railway CLI.
2. Crie um projeto e adicione PostgreSQL.
3. No serviço do app, configure DATABASE_URL apontando para ${Postgres.DATABASE_URL}.
4. Configure SECRET_KEY, ADMIN_USER e ADMIN_PASSWORD.
5. Gere um domínio público em Settings > Networking.

MIGRAR DADOS ANTIGOS
--------------------
Se o clientes.db desta pasta tiver dados que você quer levar para a nuvem:
1. Defina DATABASE_URL para o PostgreSQL.
2. Execute: python migrar_sqlite_para_postgres.py
3. O script cancela se já houver clientes no destino, para evitar duplicações.

VARIÁVEIS IMPORTANTES
---------------------
DATABASE_URL   conexão PostgreSQL em nuvem
SECRET_KEY     chave secreta da sessão
ADMIN_USER     usuário de login
ADMIN_PASSWORD senha de login

SEGURANÇA
---------
Nunca publique a senha dentro do código ou em repositório público.
Use as variáveis de ambiente do Render/Railway.
