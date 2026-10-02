SACI CLIENTES — PACOTE FINAL PARA RENDER
========================================

ESTRUTURA
---------
app.py
requirements.txt
render.yaml
Procfile
.gitignore
.env.example
static/
templates/

PUBLICAÇÃO NO RENDER
--------------------
1. Crie um repositório novo no GitHub.
2. Envie TODOS os arquivos desta pasta para a RAIZ do repositório.
   Importante: render.yaml deve aparecer na raiz, ao lado de app.py.
3. Entre em https://dashboard.render.com
4. Clique em New + > Blueprint.
5. Conecte o repositório do GitHub.
6. O Render lerá o render.yaml e criará:
   - Web Service: saci-clientes
   - PostgreSQL: saci-clientes-db
7. Quando o Render solicitar ADMIN_PASSWORD, informe uma senha forte.
8. Confirme a criação/deploy do Blueprint.
9. Quando o serviço estiver Live, abra a URL fornecida pelo Render.
10. Login inicial:
    Usuário: admin
    Senha: a que você informou em ADMIN_PASSWORD.

OBSERVAÇÃO SOBRE O PLANO GRATUITO
---------------------------------
O render.yaml está configurado com plan: free para o serviço web e o PostgreSQL.
Segundo a documentação atual do Render, o PostgreSQL gratuito expira após 30 dias.
Para uso permanente com dados reais, altere o banco para um plano pago antes do vencimento.

SEGURANÇA
---------
- Não publique senhas no GitHub.
- ADMIN_PASSWORD é solicitado pelo Render e não fica gravado no repositório.
- SECRET_KEY é gerada automaticamente pelo Render.
- O banco é conectado ao sistema através de DATABASE_URL.

BACKUP
------
Depois de entrar no sistema, use a função de backup disponível no painel regularmente.
