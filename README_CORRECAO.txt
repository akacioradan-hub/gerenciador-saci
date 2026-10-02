PACOTE CORRIGIDO PARA RENDER

1. Substitua os arquivos do seu repositório GitHub pelos arquivos deste pacote.
2. Faça commit/push.
3. No Render, abra o serviço > Manual Deploy > Deploy latest commit.
4. Em Environment, confira:
   ADMIN_USER=admin
   ADMIN_PASSWORD=<sua senha>
   DATABASE_URL deve vir do PostgreSQL do Blueprint.
5. Após o deploy, teste /health e depois /login.

Se ainda houver erro 500, abra Render > serviço > Logs e copie as últimas linhas do traceback.
