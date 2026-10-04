const recEstados=Object.fromEntries(['arcm','saci'].map(u=>[u,{clientes:[],registros:[],pagina:1,paginaClientes:1,consulta:0}]));
let recUnidade='arcm',recSalvando=false;
const recEl=id=>document.getElementById(id);
const recNome=u=>u==='arcm'?'ARCM':'Saci';
function recHoje(){const p=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Fortaleza',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return ['year','month','day'].map(k=>p.find(x=>x.type===k).value).join('-')}
function recOpcoes(u){
  const dados=recEstados[u].clientes,select=recEl('rec-'+u+'-cliente'),valor=select.value;
  select.innerHTML='<option value="">Todos</option>'+dados.map(c=>`<option value="${c.id}">${escaparFinanceiro(c.nome)}</option>`).join('');
  select.value=dados.some(c=>String(c.id)===valor)?valor:'';
}
async function recCarregar(u){
  const st=recEstados[u],consulta=++st.consulta;
  const filtros={mes:recEl('rec-'+u+'-mes').value,cliente_id:recEl('rec-'+u+'-cliente').value,status:recEl('rec-'+u+'-status').value,q:recEl('rec-'+u+'-busca').value.trim()};
  if(!filtros.mes)return;
  recEl('rec-'+u+'-aviso').textContent='Carregando…';
  try{
    const [clientes,d]=await Promise.all([api('/api/receitas/'+u+'/clientes'),api('/api/receitas/'+u+'?'+new URLSearchParams(filtros))]);
    if(consulta!==st.consulta)return;
    st.clientes=clientes;st.registros=d.registros;recOpcoes(u);
    for(const k of ['total','recebido','pendente','atrasado'])recEl('rec-'+u+'-'+k).textContent=moeda(d.resumo[k]);
    recEl('rec-'+u+'-aviso').textContent=`${d.resumo.quantidade} receita(s) · Totais de todos os resultados filtrados pela data da receita.`;
    recRender(u);recRenderClientes(u);
  }catch(e){if(consulta!==st.consulta)return;st.registros=[];recRender(u);for(const k of ['total','recebido','pendente','atrasado'])recEl('rec-'+u+'-'+k).textContent='—';recEl('rec-'+u+'-aviso').textContent='Não foi possível carregar: '+e.message}
}
function recRender(u){
  const st=recEstados[u];st.pagina=Math.min(st.pagina,Math.max(1,Math.ceil(st.registros.length/5)));
  recEl('rec-'+u+'-body').innerHTML=st.registros.slice((st.pagina-1)*5,st.pagina*5).map(r=>`<tr><td><strong>${escaparFinanceiro(r.cliente_nome)}</strong><div class="table-sub">${escaparFinanceiro(r.descricao)}</div></td><td>${escaparFinanceiro(r.categoria)}</td><td>${dataBR(r.data)}</td><td>${dataBR(r.vencimento)}</td><td>${moeda(r.valor)}</td><td><span class="badge ${r.recebida?'QUITADO':r.status==='ATRASADA'?'ATRASADO':'EM_ABERTO'}">${r.status}</span></td><td>${r.recebida?dataBR(r.data_recebimento):'—'}<div class="table-sub">${escaparFinanceiro(r.forma_pagamento||'')}</div></td><td><div class="acoes"><button type="button" class="edit icon-btn" title="Editar receita / registrar recebimento" aria-label="Editar receita / registrar recebimento" data-rec-edit="${r.id}">✎</button><button type="button" class="danger icon-btn" title="Excluir receita" aria-label="Excluir receita" data-rec-del="${r.id}">🗑</button></div></td></tr>`).join('')||'<tr><td colspan="8" class="empty">Nenhuma receita neste período.</td></tr>';
  renderPaginacaoTabela('rec-'+u,st.pagina,st.registros.length,n=>{st.pagina=n;recRender(u)});
  recEl('rec-'+u+'-body').querySelectorAll('[data-rec-edit]').forEach(b=>b.addEventListener('click',()=>recAbrir(u,Number(b.dataset.recEdit))));
  recEl('rec-'+u+'-body').querySelectorAll('[data-rec-del]').forEach(b=>b.addEventListener('click',()=>recExcluir(u,Number(b.dataset.recDel),false)));
}
function recRenderClientes(u){
  const st=recEstados[u];st.paginaClientes=Math.min(st.paginaClientes,Math.max(1,Math.ceil(st.clientes.length/5)));
  recEl('rec-'+u+'-clientesBody').innerHTML=st.clientes.slice((st.paginaClientes-1)*5,st.paginaClientes*5).map(c=>`<tr>${['nome','documento','telefone','email','endereco'].map(k=>`<td>${escaparFinanceiro(c[k]||'—')}</td>`).join('')}<td><div class="acoes"><button type="button" class="edit icon-btn" title="Editar cliente" aria-label="Editar cliente" data-cli-edit="${c.id}">✎</button><button type="button" class="danger icon-btn" title="Excluir cliente" aria-label="Excluir cliente" data-cli-del="${c.id}">🗑</button></div></td></tr>`).join('')||'<tr><td colspan="6" class="empty">Nenhum cliente cadastrado.</td></tr>';
  renderPaginacaoTabela('rec-cli-'+u,st.paginaClientes,st.clientes.length,n=>{st.paginaClientes=n;recRenderClientes(u)});
  recEl('rec-'+u+'-clientesBody').querySelectorAll('[data-cli-edit]').forEach(b=>b.addEventListener('click',()=>recAbrirCliente(u,Number(b.dataset.cliEdit))));
  recEl('rec-'+u+'-clientesBody').querySelectorAll('[data-cli-del]').forEach(b=>b.addEventListener('click',()=>recExcluir(u,Number(b.dataset.cliDel),true)));
}
function recAtualizarSituacao(){const recebido=recEl('recRecebida').value==='true',el=recEl('recDataRecebimento');el.disabled=!recebido;el.required=recebido;el.max=recHoje();if(recebido&&!el.value)el.value=recHoje();if(!recebido)el.value=''}
const recCampos={cliente_id:'Cliente',descricao:'Descricao',categoria:'Categoria',valor:'Valor',data:'Data',vencimento:'Vencimento',data_recebimento:'DataRecebimento',forma_pagamento:'Forma',documento:'Documento',observacoes:'Observacoes'};
const recCliCampos={nome:'Nome',documento:'Documento',telefone:'Telefone',email:'Email',endereco:'Endereco',observacoes:'Observacoes'};
function recAbrir(u,id){
  if(!recEstados[u].clientes.length){msg('Cadastre um cliente para lançar a receita.');recAbrirCliente(u);return}
  recUnidade=u;recEl('recForm').reset();recEl('recId').value=id||'';recEl('recErro').textContent='';
  recEl('recTitulo').textContent=(id?'Editar receita':'Nova receita')+' — '+recNome(u);
  recEl('recCliente').innerHTML='<option value="">Selecione...</option>'+recEstados[u].clientes.map(c=>`<option value="${c.id}">${escaparFinanceiro(c.nome)}</option>`).join('');
  recEl('recData').value=recHoje();recEl('recVencimento').value=recHoje();
  if(id){const r=recEstados[u].registros.find(r=>r.id===id);if(!r)return;for(const [k,v] of Object.entries(recCampos))recEl('rec'+v).value=r[k]??'';recEl('recRecebida').value=String(r.recebida)}
  recAtualizarSituacao();recEl('recModal').showModal();recEl('recCliente').focus();
}
function recAbrirCliente(u,id){
  recUnidade=u;recEl('recClienteForm').reset();recEl('recCliId').value=id||'';recEl('recCliErro').textContent='';recEl('recClienteTitulo').textContent=(id?'Editar cliente':'Novo cliente')+' — '+recNome(u);
  if(id){const c=recEstados[u].clientes.find(c=>c.id===id);if(!c)return;for(const [k,v] of Object.entries(recCliCampos))recEl('recCli'+v).value=c[k]||''}
  recEl('recClienteModal').showModal();recEl('recCliNome').focus();
}
async function recExcluir(u,id,cliente){
  if(!confirm(cliente?'Excluir este cliente?':'Excluir esta receita?'))return;
  try{await api('/api/receitas/'+u+(cliente?'/clientes':'')+'/'+id,{method:'DELETE'});await recCarregar(u);msg(cliente?'Cliente excluído.':'Receita excluída.')}catch(e){msg(e.message,'erro')}
}
async function recSalvar(e,cliente){
  e.preventDefault();if(recSalvando)return;
  const u=recUnidade,id=recEl(cliente?'recCliId':'recId').value,form=e.target,botao=form.querySelector('[type="submit"]'),erro=recEl(cliente?'recCliErro':'recErro');
  const dados=Object.fromEntries(Object.entries(cliente?recCliCampos:recCampos).map(([k,v])=>[k,recEl((cliente?'recCli':'rec')+v).value]));
  if(!cliente){dados.cliente_id=Number(dados.cliente_id);dados.valor=Number(dados.valor);dados.recebida=recEl('recRecebida').value==='true'}
  recSalvando=true;botao.disabled=true;erro.textContent='';
  try{
    await api('/api/receitas/'+u+(cliente?'/clientes':'')+(id?'/'+id:''),{method:id?'PUT':'POST',body:JSON.stringify(dados)});
    if(!cliente){recEl('rec-'+u+'-mes').value=dados.data.slice(0,7);recEstados[u].pagina=1}
    recEl(cliente?'recClienteModal':'recModal').close();await recCarregar(u);msg(cliente?'Cliente salvo.':'Receita salva.');
  }catch(e){erro.textContent=e.message}finally{recSalvando=false;botao.disabled=false}
}
recEl('recForm').addEventListener('submit',e=>recSalvar(e,false));recEl('recClienteForm').addEventListener('submit',e=>recSalvar(e,true));recEl('recRecebida').addEventListener('change',recAtualizarSituacao);
document.querySelectorAll('[data-rec-nova]').forEach(b=>b.addEventListener('click',()=>recAbrir(b.dataset.recNova)));
document.querySelectorAll('[data-rec-cliente]').forEach(b=>b.addEventListener('click',()=>recAbrirCliente(b.dataset.recCliente)));
document.querySelectorAll('[data-rec-fechar]').forEach(b=>b.addEventListener('click',()=>{if(!recSalvando)recEl(b.dataset.recFechar).close()}));
for(const id of ['recModal','recClienteModal']){const modal=recEl(id);modal.addEventListener('cancel',e=>{if(recSalvando)e.preventDefault()});modal.addEventListener('click',e=>{if(e.target!==modal||recSalvando)return;const r=modal.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)modal.close()})}
for(const u of ['arcm','saci']){
  recEl('rec-'+u+'-mes').value=recHoje().slice(0,7);
  for(const campo of ['mes','cliente','status','busca'])recEl('rec-'+u+'-'+campo).addEventListener(campo==='busca'?'input':'change',()=>{recEstados[u].pagina=1;recCarregar(u)});
  document.querySelector('[data-tab="receitas-'+u+'"]').addEventListener('click',()=>recCarregar(u));
}
