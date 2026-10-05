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
    recRender(u);recRenderClientes(u);if(u==='saci'&&typeof fluxoCarregar==='function')await fluxoCarregar();if(u==='arcm'){await recCarregarPrevisao();if(typeof fluxoArcmCarregar==='function')await fluxoArcmCarregar();}
  }catch(e){if(consulta!==st.consulta)return;st.registros=[];recRender(u);for(const k of ['total','recebido','pendente','atrasado'])recEl('rec-'+u+'-'+k).textContent='—';recEl('rec-'+u+'-aviso').textContent='Não foi possível carregar: '+e.message}
}
function recRender(u){
  const st=recEstados[u];st.pagina=Math.min(st.pagina,Math.max(1,Math.ceil(st.registros.length/5)));
  recEl('rec-'+u+'-body').innerHTML=st.registros.slice((st.pagina-1)*5,st.pagina*5).map(r=>`<tr><td><strong>${escaparFinanceiro(u==='saci'?r.descricao:r.cliente_nome)}</strong><div class="table-sub">${escaparFinanceiro(u==='saci'?(r.cliente_nome||'Sem cliente'):r.descricao)}</div>${r.contrato?`<div class="table-sub">Contrato ${escaparFinanceiro(r.contrato.numero)} · Parcela ${r.parcela}/${r.contrato.parcelas}</div>`:''}</td><td>${escaparFinanceiro(r.categoria)}</td><td>${dataBR(r.data)}</td><td>${dataBR(r.vencimento)}</td><td>${moeda(r.valor)}</td><td><span class="badge ${r.recebida?'QUITADO':r.status==='ATRASADA'?'ATRASADO':'EM_ABERTO'}">${r.status}</span></td><td><div class="rec-status-actions"><button type="button" class="secondary rec-status-icon ${r.recebida?'rec-reabrir':'rec-pago'}" data-rec-status="${r.id}" title="${r.recebida?'Reabrir receita':'Marcar como pago'}" aria-label="${r.recebida?'Reabrir receita':'Marcar como pago'}"><span aria-hidden="true">${r.recebida?'↶':'✓'}</span></button>${r.recebida?`<span class="table-sub">${dataBR(r.data_recebimento)}</span>`:''}</div><div class="table-sub">${escaparFinanceiro(r.forma_pagamento||'')}</div></td><td><div class="acoes"><button type="button" class="edit icon-btn" title="Editar receita / registrar recebimento" aria-label="Editar receita / registrar recebimento" data-rec-edit="${r.id}">✎</button><button type="button" class="danger icon-btn" title="Excluir receita" aria-label="Excluir receita" data-rec-del="${r.id}">🗑</button></div></td></tr>`).join('')||'<tr><td colspan="8" class="empty">Nenhuma receita neste período.</td></tr>';
  renderPaginacaoTabela('rec-'+u,st.pagina,st.registros.length,n=>{st.pagina=n;recRender(u)});
  recEl('rec-'+u+'-body').querySelectorAll('[data-rec-status]').forEach(b=>b.addEventListener('click',()=>recMudarStatus(u,Number(b.dataset.recStatus),b)));
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
  if(u==='arcm'&&!recEstados[u].clientes.length){msg('Cadastre um cliente para lançar a receita.');recAbrirCliente(u);return}
  recUnidade=u;recEl('recForm').reset();recEl('recId').value=id||'';recEl('recErro').textContent='';
  recEl('recTitulo').textContent=(id?'Editar receita':u==='saci'?'Nova entrada manual':'Nova receita')+' — '+recNome(u);
  recEl('recCliente').required=u==='arcm';recEl('recClienteLabel').textContent=u==='saci'?'Cliente (opcional)':'Cliente *';
  recEl('recCategoriaLabel').textContent=u==='saci'?'Fonte da receita':'Categoria';
  const atual=id?recEstados[u].registros.find(r=>r.id===id):null;
  const categorias=u==='saci'?['Caixa','Fiado','Serviço']:['Vendas','Serviços','Outras receitas'];
  const formas=u==='saci'?['Pix','Dinheiro','Cartão crédito','Cartão débito']:['Pix','Dinheiro','Cartão','Transferência','Boleto','Outro'];
  if(atual?.categoria&&!categorias.includes(atual.categoria))categorias.push(atual.categoria);
  if(atual?.forma_pagamento&&!formas.includes(atual.forma_pagamento))formas.push(atual.forma_pagamento);
  recEl('recCategoria').innerHTML=categorias.map(v=>`<option>${escaparFinanceiro(v)}</option>`).join('');
  recEl('recForma').innerHTML='<option value="">Não informada</option>'+formas.map(v=>`<option>${escaparFinanceiro(v)}</option>`).join('');
  recEl('recCliente').innerHTML=`<option value="">${u==='saci'?'Sem cliente':'Selecione...'}</option>`+recEstados[u].clientes.map(c=>`<option value="${c.id}">${escaparFinanceiro(c.nome)}</option>`).join('');
  recEl('recData').value=recHoje();recEl('recVencimento').value=recHoje();
  if(u==='saci'&&!id)recEl('recRecebida').value='true';
  if(id){const r=recEstados[u].registros.find(r=>r.id===id);if(!r)return;for(const [k,v] of Object.entries(recCampos))recEl('rec'+v).value=r[k]??'';recEl('recRecebida').value=String(r.recebida)}
  recConfigurarContrato(u,id?recEstados[u].registros.find(r=>r.id===id):null);recAtualizarSituacao();recEl('recModal').showModal();recEl('recCliente').focus();
}
function recAbrirCliente(u,id){
  recUnidade=u;recEl('recClienteForm').reset();recEl('recCliId').value=id||'';recEl('recCliErro').textContent='';recEl('recClienteTitulo').textContent=(id?'Editar cliente':'Novo cliente')+' — '+recNome(u);
  if(id){const c=recEstados[u].clientes.find(c=>c.id===id);if(!c)return;for(const [k,v] of Object.entries(recCliCampos))recEl('recCli'+v).value=c[k]||''}
  recEl('recClienteModal').showModal();recEl('recCliNome').focus();
}
async function recExcluir(u,id,cliente){
  if(!confirm(cliente?'Excluir este cliente?':'Excluir somente esta receita/parcela? O valor será retirado da previsão e as demais parcelas serão mantidas.'))return;
  try{await api('/api/receitas/'+u+(cliente?'/clientes':'')+'/'+id,{method:'DELETE'});await recCarregar(u);msg(cliente?'Cliente excluído.':'Receita excluída.')}catch(e){msg(e.message,'erro')}
}
async function recSalvar(e,cliente){
  e.preventDefault();if(recSalvando)return;
  const u=recUnidade,id=recEl(cliente?'recCliId':'recId').value,form=e.target,botao=form.querySelector('[type="submit"]'),erro=recEl(cliente?'recCliErro':'recErro');
  const dados=Object.fromEntries(Object.entries(cliente?recCliCampos:recCampos).map(([k,v])=>[k,recEl((cliente?'recCli':'rec')+v).value]));
  if(!cliente){dados.cliente_id=dados.cliente_id?Number(dados.cliente_id):null;dados.valor=Number(dados.valor);dados.recebida=recEl('recRecebida').value==='true'}
  if(!cliente&&u==='arcm'&&!id){
    dados.numero_contrato=recEl('recNumeroContrato').value.trim();dados.tipo_pagamento=recEl('recTipoPagamento').value;dados.prazo_meses=Number(recEl('recPrazoMeses').value);dados.inicio_contrato=recEl('recInicioContrato').value;
    const previsao=recPlanejarContrato();
    if(previsao.erro){erro.textContent=previsao.erro;return}
    if(previsao.datas.length>1&&!confirm(`Criar ${previsao.datas.length} receitas de ${moeda(dados.valor)}? Total previsto: ${moeda(dados.valor*previsao.datas.length)}. As parcelas futuras ficarão pendentes.`))return;
  }
  recSalvando=true;botao.disabled=true;erro.textContent='';
  try{
    const resultado=await api('/api/receitas/'+u+(cliente?'/clientes':'')+(id?'/'+id:''),{method:id?'PUT':'POST',body:JSON.stringify(dados)});
    if(!cliente){recEl('rec-'+u+'-mes').value=(resultado.data||dados.data).slice(0,7);recEstados[u].pagina=1}
    recEl(cliente?'recClienteModal':'recModal').close();await recCarregar(u);msg(cliente?'Cliente salvo.':resultado.parcelas_criadas>1?`${resultado.parcelas_criadas} receitas criadas. Total previsto: ${moeda(resultado.total_previsto)}.`:'Receita salva.');
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

let recContratoEditando=false,recPrevisaoConsulta=0;
function recSomarMeses(iso,meses){
  const [a,m,d]=iso.split('-').map(Number),ultimo=new Date(Date.UTC(a,m+meses,0)).getUTCDate();
  const dt=new Date(Date.UTC(a,m-1+meses,Math.min(d,ultimo)));return dt.toISOString().slice(0,10);
}
function recPlanejarContrato(){
  const tipo=recEl('recTipoPagamento').value,numero=recEl('recNumeroContrato').value.trim(),prazo=Number(recEl('recPrazoMeses').value),inicio=recEl('recInicioContrato').value,venc=recEl('recVencimento').value;
  const passo={avista:0,mensal:1,trimestral:3,semestral:6,anual:12}[tipo];
  if(tipo==='avista'&&!numero)return {datas:[]};
  if(!numero)return {datas:[],erro:'Informe o número do contrato para gerar as parcelas.'};
  if(!Number.isInteger(prazo)||prazo<1||prazo>600||!inicio||!venc)return {datas:[],erro:'Informe início, prazo de 1 a 600 meses e primeiro vencimento.'};
  const quantidade=passo?Math.ceil(prazo/passo):1;
  const fimDt=new Date(recSomarMeses(inicio,prazo)+'T12:00:00Z');fimDt.setUTCDate(fimDt.getUTCDate()-1);const fim=fimDt.toISOString().slice(0,10);
  const datas=Array.from({length:quantidade},(_,i)=>recSomarMeses(venc,i*passo));
  if(datas[0]<inicio||datas.at(-1)>fim)return {datas:[],erro:'Os vencimentos devem ficar dentro do prazo do contrato. Confira as datas.'};
  return {datas,fim};
}
function recConfigurarContrato(u,r){
  recContratoEditando=!!r;const ativo=u==='arcm',c=r?.contrato;
  recEl('recContratoCampos').classList.toggle('hidden',!ativo);
  for(const id of ['recNumeroContrato','recTipoPagamento','recPrazoMeses','recInicioContrato'])recEl(id).disabled=!ativo||!!r;
  recEl('recNumeroContrato').value=c?.numero||'';recEl('recTipoPagamento').value=c?.tipo_pagamento||'avista';recEl('recPrazoMeses').value=c?.prazo_meses||1;recEl('recInicioContrato').value=c?.inicio||recHoje();
  recEl('recCliente').disabled=!!c;
  if(r&&ativo){
    recEl('recContratoResumo').textContent=c?`Contrato ${c.numero} · Prazo: ${c.prazo_meses} meses · ${dataBR(c.inicio)} a ${dataBR(c.fim)}. Editando somente a parcela ${r.parcela}/${c.parcelas}; salvar não gera novas parcelas.`:'Receita avulsa existente. Para gerar um contrato parcelado, use Nova receita.';
    recEl('recContratoPreview').innerHTML='';
  }
  recAtualizarContrato();
}
function recAtualizarContrato(){
  const ativo=recUnidade==='arcm',recorrente=ativo&&recEl('recTipoPagamento').value!=='avista',novo=ativo&&!recContratoEditando;
  recEl('recValorLabel').textContent=recorrente?'Valor de cada pagamento (R$) *':'Valor (R$) *';
  recEl('recDataLabel').textContent=novo&&recorrente?'Data do cadastro *':'Data da receita *';
  recEl('recVencimentoLabel').textContent=novo&&recorrente?'Primeiro vencimento *':'Vencimento *';
  recEl('recNumeroContrato').required=novo&&recorrente;
  const temContrato=novo&&(recorrente||!!recEl('recNumeroContrato').value.trim());
  recEl('recPrazoMeses').required=temContrato;recEl('recInicioContrato').required=temContrato;
  if(!novo)return;
  const p=recPlanejarContrato(),valor=Number(recEl('recValor').value||0);
  recEl('recContratoResumo').textContent=p.erro||(!p.datas.length?'À vista: um lançamento. Informe o número para vincular a um contrato.':`${p.datas.length} pagamento(s) de ${moeda(valor)} · Total previsto: ${moeda(valor*p.datas.length)} · Fim do contrato: ${dataBR(p.fim)}. O valor informado é por pagamento. Nas receitas recorrentes, cada parcela aparecerá no mês do seu vencimento; apenas a primeira poderá ser registrada como recebida agora.`);
  recEl('recContratoPreview').innerHTML=p.datas.slice(0,6).map((d,i)=>`<tr><td>${i+1}/${p.datas.length}</td><td>${dataBR(d)}</td><td>${moeda(valor)}</td></tr>`).join('')+(p.datas.length>6?`<tr><td colspan="3">Mais ${p.datas.length-6} pagamentos. Último vencimento: ${dataBR(p.datas.at(-1))}.</td></tr>`:'');
}
for(const id of ['recNumeroContrato','recTipoPagamento','recPrazoMeses','recInicioContrato','recVencimento','recValor'])recEl(id).addEventListener('input',recAtualizarContrato);
async function recCarregarPrevisao(){
  const consulta=++recPrevisaoConsulta,mes=recEl('rec-arcm-mes').value,cliente=recEl('rec-arcm-cliente').value;
  recEl('recPrevisaoAviso').textContent='Carregando previsão…';
  try{
    const d=await api('/api/receitas/arcm/previsao?'+new URLSearchParams({mes,cliente_id:cliente}));if(consulta!==recPrevisaoConsulta)return;
    recEl('recPrevisaoBody').innerHTML=d.meses.map(m=>`<tr><td>${mesLabel(m.mes)}</td><td>${moeda(m.total)}</td><td>${moeda(m.recebido)}</td><td>${moeda(m.pendente)}</td></tr>`).join('');
    recEl('recPrevisaoAviso').textContent='Total a receber nos 12 meses: '+moeda(d.meses.reduce((s,m)=>s+m.pendente,0));
  }catch(e){if(consulta!==recPrevisaoConsulta)return;recEl('recPrevisaoBody').innerHTML='';recEl('recPrevisaoAviso').textContent='Não foi possível carregar a previsão: '+e.message}
}

async function recMudarStatus(u,id,botao){
  const r=recEstados[u].registros.find(r=>r.id===id);if(!r||botao.disabled)return;
  const recebida=!r.recebida;let data=null;
  if(recebida){data=prompt('Data do recebimento (AAAA-MM-DD):',recHoje());if(data===null)return;data=data.trim()}
  else if(!confirm('Reabrir esta receita e remover a data do recebimento? Somente esta parcela será alterada.'))return;
  botao.disabled=true;
  try{await api('/api/receitas/'+u+'/'+id+'/status',{method:'PATCH',body:JSON.stringify({recebida,data_recebimento:data})});await recCarregar(u);msg(recebida?'Receita marcada como paga.':'Receita reaberta.')}catch(e){msg(e.message,'erro')}finally{botao.disabled=false}
}
