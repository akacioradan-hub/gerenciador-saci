// Contas a pagar; utiliza as mesmas funções de API e mensagens do painel.
const despCategorias={
  'Custos fixos':['Salários','Encargos trabalhistas','Água','Luz','Telefone','Internet','Aluguel','Contabilidade','Seguros','Sistemas e assinaturas','Impostos e taxas','Outros custos fixos'],
  'Fornecedores':['Mercadorias','Materiais e insumos','Frete','Serviços contratados','Outros fornecedores'],
  'Despesas variáveis':['Manutenção de veículo','Combustível','Adiantamento de funcionário','Reembolso de funcionário','Manutenção da loja','Equipamentos','Material de escritório','Limpeza','Publicidade','Outras despesas variáveis']
};
let despesasMes=[],despCadastros={funcionarios:[],veiculos:[],fornecedores:[],terceirizados:[]},despTipoCadastro='funcionarios';
const despEl=id=>document.getElementById(id);
const despNomes={funcionarios:'Funcionários',veiculos:'Veículos',fornecedores:'Fornecedores',terceirizados:'Terceirizados'};
const despHoje=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
function despParametros(){
  const params=new URLSearchParams({mes:despEl('despMes').value});
  const campos={despFiltroGrupo:'grupo',despFiltroCategoria:'categoria',despFiltroStatus:'status',despFiltroPrioridade:'prioridade',despFiltroFuncionario:'funcionario_id',despFiltroVeiculo:'veiculo_id',despFiltroFornecedor:'fornecedor_id',despFiltroTerceirizado:'terceirizado_id',despBusca:'q'};
  Object.entries(campos).forEach(([id,campo])=>{const v=despEl(id).value.trim();if(v)params.set(campo,v)});
  return params;
}
let despRequisicao=0;
async function carregarDespesas(){
  if(!despEl('despMes').value){msg('Selecione um mês de competência.','erro');return}
  const numero=++despRequisicao;
  const params=despParametros();
  const d=await api('/api/despesas?'+params);
  if(numero!==despRequisicao)return;
  despesasMes=d.registros||[];
  const r=d.resumo||{};
  for(const [id,campo] of Object.entries({despTotal:'total',despPagoTotal:'pago',despAberto:'aberto',despAtrasado:'atrasado'}))despEl(id).textContent=moeda(r[campo]);
  despEl('despContagem').textContent=`${r.quantidade||0} conta(s) · Totais conforme o mês de competência e os filtros.`;
  despEl('despGrupos').innerHTML=Object.entries(r.por_grupo||{}).map(([g,v])=>`<div><span>${escaparFinanceiro(g)}</span><strong>${moeda(v)}</strong></div>`).join('');
  despEl('despExportar').href='/api/exportar/despesas.csv?'+params;
  renderResumoVinculado(r,params);
  renderContasMes();
}
function renderResumoVinculado(resumo,params){
  const selecionados=[];
  for(const [tipo,campo] of [['funcionarios','funcionario_id'],['veiculos','veiculo_id'],['fornecedores','fornecedor_id'],['terceirizados','terceirizado_id']]){
    const id=params.get(campo);
    if(!id)continue;
    const cadastro=despCadastros[tipo].find(r=>String(r.id)===id);
    selecionados.push(cadastro?cadastro.nome+(cadastro.placa?' · '+cadastro.placa:''):despNomes[tipo]);
  }
  despEl('despResumoVinculado').classList.toggle('hidden',selecionados.length===0);
  if(!selecionados.length)return;
  despEl('despResumoVinculadoNome').textContent='Despesas: '+selecionados.join(' · ');
  const competencia=params.get('mes');
  const [ano,mes]=competencia.split('-').map(Number);
  const ultimoDia=new Date(ano,mes,0).getDate();
  despEl('despVincPeriodo').textContent=new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(new Date(ano,mes-1,1));
  despEl('despVincDatas').textContent=dataBR(competencia+'-01')+' a '+dataBR(competencia+'-'+String(ultimoDia).padStart(2,'0'));
  despEl('despVincTotal').textContent=moeda(resumo.total);
  despEl('despVincPago').textContent=moeda(resumo.pago);
  despEl('despVincAberto').textContent=moeda(resumo.aberto);
}
const DESP_POR_PAGINA=10;
let despPagina=1;
function renderContasMes(){
  const total=despesasMes.length;
  const paginas=Math.max(1,Math.ceil(total/DESP_POR_PAGINA));
  despPagina=Math.max(1,Math.min(despPagina,paginas));
  const inicio=(despPagina-1)*DESP_POR_PAGINA;
  despEl('despesasBody').innerHTML=despesasMes.length?despesasMes.slice(inicio,inicio+DESP_POR_PAGINA).map(r=>{
    const vinculos=[r.fornecedor_nome,r.funcionario_nome,r.veiculo_nome,r.terceirizado_nome].filter(Boolean);
    return `<tr><td><strong>${escaparFinanceiro(r.descricao)}</strong><div class="table-sub">${escaparFinanceiro(r.grupo)} · ${escaparFinanceiro(r.categoria)}</div>${r.documento?`<div class="table-sub">${escaparFinanceiro(r.documento)}</div>`:''}</td>
      <td>${vinculos.map(v=>`<div class="table-sub">${escaparFinanceiro(v)}</div>`).join('')||'—'}</td>
      <td><span class="desp-priority ${escaparFinanceiro(r.prioridade)}">${escaparFinanceiro(r.prioridade)}</span></td>
      <td>${dataBR(r.vencimento)}</td><td>${moeda(r.valor)}</td>
      <td><div class="desp-pay-actions"><span class="badge ${statusClass(r.status)}">${escaparFinanceiro(r.status)}</span>${r.pago?`<span class="table-sub">${dataBR(r.data_pagamento)}</span>`:''}<button type="button" class="secondary" onclick="pagarDespesa(${r.id},${!r.pago})">${r.pago?'Reabrir':'Marcar pago'}</button></div></td>
      <td><div class="acoes icon-actions"><button type="button" class="edit icon-btn" aria-label="Editar despesa" title="Editar despesa" onclick="editarDespesa(${r.id})">✎</button><button type="button" class="danger icon-btn" aria-label="Excluir despesa" title="Excluir despesa" onclick="excluirDespesa(${r.id})">🗑</button></div></td></tr>`;
  }).join(''):'<tr><td colspan="7" class="empty">Nenhuma despesa para o mês e os filtros selecionados.</td></tr>';
  despEl('despPaginaResumo').textContent=total?`${inicio+1}–${Math.min(inicio+DESP_POR_PAGINA,total)} de ${total} contas · Página ${despPagina} de ${paginas}`:'0 contas';
  const botao=(pagina,label,extra='')=>`<button type="button" class="secondary ${pagina===despPagina?'current-page':''}" ${extra} onclick="mudarPaginaDespesas(${pagina})">${label}</button>`;
  let html=botao(despPagina-1,'Anterior',despPagina===1?'disabled':'');
  const numeros=new Set([1,paginas]);
  for(let n=Math.max(1,despPagina-2);n<=Math.min(paginas,despPagina+2);n++)numeros.add(n);
  let anterior=0;
  for(const n of [...numeros].sort((a,b)=>a-b)){
    if(anterior&&n>anterior+1)html+='<span class="pagination-gap">…</span>';
    html+=botao(n,n,`aria-label="Página ${n}" ${n===despPagina?'aria-current="page"':''}`);anterior=n;
  }
  html+=botao(despPagina+1,'Próxima',despPagina===paginas?'disabled':'');
  despEl('despPaginas').innerHTML=html;
}
function mudarPaginaDespesas(pagina){
  if(!Number.isInteger(pagina)||pagina<1||pagina>Math.max(1,Math.ceil(despesasMes.length/DESP_POR_PAGINA)))return;
  despPagina=pagina;renderContasMes();
}
function atualizarFiltroCategoria(){
  const el=despEl('despFiltroCategoria'),valor=el.value;
  const grupo=despEl('despFiltroGrupo').value;
  const categorias=grupo?despCategorias[grupo]:Object.values(despCategorias).flat();
  el.innerHTML='<option value="">Todas</option>'+categorias.map(c=>`<option>${escaparFinanceiro(c)}</option>`).join('');
  el.value=categorias.includes(valor)?valor:'';
}
function filtrarContasMes(){despPagina=1;return carregarDespesas()}

function despOpcoes(id,tipo,filtro=false){
  const el=despEl(id),valor=el.value;
  el.innerHTML=`<option value="">${filtro?'Todos':'Sem vínculo'}</option>`+despCadastros[tipo].map(r=>`<option value="${r.id}">${escaparFinanceiro(r.nome+(r.placa?' · '+r.placa:''))}</option>`).join('');
  el.value=despCadastros[tipo].some(r=>String(r.id)===valor)?valor:'';
}
async function carregarCadastrosDespesas(){
  despCadastros=await api('/api/despesas/cadastros');
  for(const [tipo,campo] of [['funcionarios','Funcionario'],['veiculos','Veiculo'],['fornecedores','Fornecedor'],['terceirizados','Terceirizado']]){
    despOpcoes('desp'+campo,tipo);despOpcoes('despFiltro'+campo,tipo,true);
  }
  renderCadastrosDespesas();
}
function despAtualizarCategoria(valor){
  const grupo=despEl('despGrupo').value;
  despEl('despCategoria').innerHTML=despCategorias[grupo].map(c=>`<option>${c}</option>`).join('');
  if(valor&&despCategorias[grupo].includes(valor))despEl('despCategoria').value=valor;
  despEl('despFornecedor').required=grupo==='Fornecedores';
}
function despAtualizarPago(){
  const pago=despEl('despPago').checked;
  despEl('despDataPagamento').disabled=!pago;despEl('despDataPagamento').required=pago;
  if(pago&&!despEl('despDataPagamento').value)despEl('despDataPagamento').value=despHoje();
  if(!pago)despEl('despDataPagamento').value='';
}
function limparFichaDespesa(){
  despEl('despForm').reset();despEl('despId').value='';
  despEl('despCompetencia').value=despEl('despMes').value;
  despEl('despPrioridade').value='Normal';despAtualizarCategoria();despAtualizarPago();
  despEl('despTitulo').textContent='Cadastrar despesa';
}
function novaDespesa(){
  limparFichaDespesa();
  const modal=despEl('despCadastro');modal.classList.remove('hidden');
  if(!modal.open)modal.showModal();
  despEl('despDescricao').focus();
}
function fecharCadastroDespesa(){
  const modal=despEl('despCadastro');
  if(modal.open)modal.close();
  modal.classList.add('hidden');limparFichaDespesa();
}
function editarDespesa(id){
  const r=despesasMes.find(x=>x.id===id);if(!r)return;
  novaDespesa();despEl('despGrupo').value=r.grupo;despAtualizarCategoria(r.categoria);
  const campos={despId:'id',despDescricao:'descricao',despCompetencia:'competencia',despVencimento:'vencimento',despValor:'valor',despPrioridade:'prioridade',despFornecedor:'fornecedor_id',despTerceirizado:'terceirizado_id',despFuncionario:'funcionario_id',despVeiculo:'veiculo_id',despDocumento:'documento',despObservacoes:'observacoes',despDataPagamento:'data_pagamento'};
  Object.entries(campos).forEach(([id,campo])=>despEl(id).value=r[campo]??'');
  despEl('despPago').checked=r.pago;despAtualizarPago();despEl('despTitulo').textContent='Editar despesa';
}
async function pagarDespesa(id,pago){
  let data=null;
  if(pago){data=prompt('Data do pagamento (AAAA-MM-DD):',despHoje());if(data===null)return}
  else if(!confirm('Reabrir esta conta e remover a data de pagamento?'))return;
  try{await api('/api/despesas/'+id+'/status',{method:'PATCH',body:JSON.stringify({pago,data_pagamento:data})});await carregarDespesas();msg(pago?'Despesa marcada como paga.':'Despesa reaberta.')}catch(e){msg(e.message,'erro')}
}
async function excluirDespesa(id){
  if(!confirm('Excluir esta despesa?'))return;
  try{await api('/api/despesas/'+id,{method:'DELETE'});await carregarDespesas();msg('Despesa excluída.')}catch(e){msg(e.message,'erro')}
}
function limparCadastroDespesa(){despEl('despCadForm').reset();despEl('despCadId').value=''}
function trocarCadastroDespesa(tipo,abrir=false){
  despTipoCadastro=tipo;limparCadastroDespesa();despEl('despCadTitulo').textContent=despNomes[tipo];
  document.querySelectorAll('[data-desp-field]').forEach(el=>el.classList.toggle('hidden',!el.dataset.despField.split(' ').includes(tipo)));
  despEl('despCadPlaca').required=tipo==='veiculos';
  despEl('despCadForm').classList.toggle('hidden',!abrir);
  if(abrir)despEl('despCadForm').scrollIntoView({behavior:'smooth',block:'start'});
  renderCadastrosDespesas();
}
function renderCadastrosDespesas(){
  const funcionarios=despTipoCadastro==='funcionarios';
  const colunas=funcionarios?['Nome','Cargo','Data de nascimento','Endereço','Telefone','Ações']:['Nome','Informações','Ações'];
  despEl('despCadHead').innerHTML='<tr>'+colunas.map(c=>`<th scope="col">${c}</th>`).join('')+'</tr>';
  const registros=despCadastros[despTipoCadastro];
  despEl('despCadBody').innerHTML=registros.length?registros.map(r=>{
    const informacoes=funcionarios?
      `<td>${escaparFinanceiro(r.cargo||'—')}</td><td>${dataBR(r.data_nascimento)}</td><td>${escaparFinanceiro(r.endereco||'—')}</td><td>${escaparFinanceiro(r.telefone||'—')}</td>`:
      `<td>${escaparFinanceiro([r.servico,r.placa,r.ano,r.telefone,r.documento].filter(Boolean).join(' · '))||'—'}</td>`;
    return `<tr><td>${escaparFinanceiro(r.nome)}</td>${informacoes}<td><div class="acoes"><button type="button" class="secondary" onclick="verDespesasVinculadas(${r.id})">Ver despesas</button><button type="button" class="edit icon-btn" title="Editar cadastro" aria-label="Editar cadastro" onclick="editarCadastroDespesa(${r.id})">✎</button><button type="button" class="danger icon-btn" title="Excluir cadastro" aria-label="Excluir cadastro" onclick="excluirCadastroDespesa(${r.id})">🗑</button></div></td></tr>`;
  }).join(''):`<tr><td colspan="${colunas.length}" class="empty">Nenhum cadastro.</td></tr>`;
}
function editarCadastroDespesa(id){
  const r=despCadastros[despTipoCadastro].find(x=>x.id===id);if(!r)return;
  for(const [campo,sufixo] of Object.entries({id:'Id',nome:'Nome',cargo:'Cargo',data_nascimento:'Nascimento',endereco:'Endereco',servico:'Servico',telefone:'Telefone',placa:'Placa',ano:'Ano',documento:'Documento',observacoes:'Observacoes'}))despEl('despCad'+sufixo).value=r[campo]??'';
  despEl('despCadForm').classList.remove('hidden');
  despEl('despCadForm').scrollIntoView({behavior:'smooth',block:'start'});
}
async function excluirCadastroDespesa(id){
  if(!confirm('Excluir este cadastro? Cadastros com despesas vinculadas serão preservados.'))return;
  try{await api('/api/despesas/cadastros/'+despTipoCadastro+'/'+id,{method:'DELETE'});await carregarCadastrosDespesas();msg('Cadastro excluído.')}catch(e){msg(e.message,'erro')}
}
function fecharVinculadosModal(){
  const modal=despEl('despVinculadosCard');
  if(modal.open)modal.close();
  modal.classList.add('hidden');despEl('despAbrirVinculados').setAttribute('aria-expanded','false');
}
async function verDespesasVinculadas(id){
  for(const campo of ['despFiltroGrupo','despFiltroCategoria','despFiltroStatus','despFiltroPrioridade','despFiltroFuncionario','despFiltroVeiculo','despFiltroFornecedor','despFiltroTerceirizado','despBusca'])despEl(campo).value='';
  despEl({funcionarios:'despFiltroFuncionario',veiculos:'despFiltroVeiculo',fornecedores:'despFiltroFornecedor',terceirizados:'despFiltroTerceirizado'}[despTipoCadastro]).value=String(id);
  try{atualizarFiltroCategoria();await filtrarContasMes();fecharVinculadosModal();despEl('despContasCard').scrollIntoView({behavior:'smooth',block:'start'})}catch(e){msg(e.message,'erro')}
}
if(despEl('despesas')){
  despEl('despMes').value=despHoje().slice(0,7);
  despEl('novaDespesa').addEventListener('click',()=>novaDespesa());
  despEl('despAbrirVinculados').addEventListener('click',()=>{
    const modal=despEl('despVinculadosCard');modal.classList.remove('hidden');
    if(!modal.open)modal.showModal();
    despEl('despAbrirVinculados').setAttribute('aria-expanded','true');
    despEl('despVinculadosFechar').focus();
  });
  despEl('despVinculadosFechar').addEventListener('click',fecharVinculadosModal);
  despEl('despVinculadosCard').addEventListener('close',()=>{
    despEl('despVinculadosCard').classList.add('hidden');
    despEl('despAbrirVinculados').setAttribute('aria-expanded','false');
  });
  despEl('despVinculadosCard').addEventListener('click',e=>{
    const modal=despEl('despVinculadosCard');if(e.target!==modal)return;
    const box=modal.getBoundingClientRect();
    if(e.clientX<box.left||e.clientX>box.right||e.clientY<box.top||e.clientY>box.bottom)fecharVinculadosModal();
  });
  despEl('despCancelar').addEventListener('click',fecharCadastroDespesa);
  despEl('despModalFechar').addEventListener('click',fecharCadastroDespesa);
  despEl('despCadastro').addEventListener('close',()=>{
    despEl('despCadastro').classList.add('hidden');limparFichaDespesa();
  });
  despEl('despCadastro').addEventListener('click',e=>{
    const modal=despEl('despCadastro');if(e.target!==modal)return;
    const box=modal.getBoundingClientRect();
    if(e.clientX<box.left||e.clientX>box.right||e.clientY<box.top||e.clientY>box.bottom)fecharCadastroDespesa();
  });
  despEl('despGrupo').addEventListener('change',()=>despAtualizarCategoria());
  despEl('despPago').addEventListener('change',despAtualizarPago);
  despEl('despForm').addEventListener('submit',async e=>{
    e.preventDefault();const id=despEl('despId').value;
    const campos={descricao:'Descricao',grupo:'Grupo',categoria:'Categoria',competencia:'Competencia',vencimento:'Vencimento',valor:'Valor',prioridade:'Prioridade',fornecedor_id:'Fornecedor',terceirizado_id:'Terceirizado',funcionario_id:'Funcionario',veiculo_id:'Veiculo',documento:'Documento',observacoes:'Observacoes',data_pagamento:'DataPagamento'};
    const payload=Object.fromEntries(Object.entries(campos).map(([k,v])=>[k,despEl('desp'+v).value]));payload.pago=despEl('despPago').checked;
    try{await api(id?'/api/despesas/'+id:'/api/despesas',{method:id?'PUT':'POST',body:JSON.stringify(payload)});despEl('despMes').value=payload.competencia;fecharCadastroDespesa();await carregarDespesas();msg(id?'Despesa atualizada.':'Despesa cadastrada.')}catch(e){msg(e.message,'erro')}
  });
  ['despMes','despFiltroGrupo','despFiltroCategoria','despFiltroStatus','despFiltroPrioridade','despFiltroFuncionario','despFiltroVeiculo','despFiltroFornecedor','despFiltroTerceirizado'].forEach(id=>despEl(id).addEventListener('change',()=>{if(id==='despFiltroGrupo')atualizarFiltroCategoria();filtrarContasMes().catch(e=>msg(e.message,'erro'))}));
  despEl('despBusca').addEventListener('input',()=>{clearTimeout(window._despBusca);window._despBusca=setTimeout(()=>filtrarContasMes().catch(e=>msg(e.message,'erro')),250)});
  document.querySelectorAll('[data-desp-catalog]').forEach(b=>b.addEventListener('click',()=>trocarCadastroDespesa(b.dataset.despCatalog,true)));
  despEl('despExibirCadastros').addEventListener('click',()=>{
    const lista=despEl('despListaCadastros'),botao=despEl('despExibirCadastros');
    const mostrar=lista.classList.contains('hidden');
    lista.classList.toggle('hidden',!mostrar);
    botao.textContent=mostrar?'Ocultar cadastrados':'Exibir cadastrados';
    botao.setAttribute('aria-expanded',String(mostrar));
  });
  despEl('despCadCancelar').addEventListener('click',()=>{limparCadastroDespesa();despEl('despCadForm').classList.add('hidden')});
  despEl('despCadForm').addEventListener('submit',async e=>{
    e.preventDefault();const id=despEl('despCadId').value;
    const payload=Object.fromEntries(Object.entries({nome:'Nome',cargo:'Cargo',data_nascimento:'Nascimento',endereco:'Endereco',servico:'Servico',telefone:'Telefone',placa:'Placa',ano:'Ano',documento:'Documento',observacoes:'Observacoes'}).map(([k,v])=>[k,despEl('despCad'+v).value]));
    try{await api('/api/despesas/cadastros/'+despTipoCadastro+(id?'/'+id:''),{method:id?'PUT':'POST',body:JSON.stringify(payload)});limparCadastroDespesa();despEl('despCadForm').classList.add('hidden');await carregarCadastrosDespesas();await carregarDespesas();await carregarDashboard();msg('Cadastro salvo.')}catch(e){msg(e.message,'erro')}
  });
  document.querySelectorAll('.tab-btn[data-tab="despesas"]').forEach(b=>b.addEventListener('click',async()=>{
    try{await carregarCadastrosDespesas();await carregarDespesas()}catch(e){msg(e.message,'erro')}
  }));
  despEl('despLimparFiltros').addEventListener('click',()=>{
    clearTimeout(window._despBusca);
    for(const id of ['despFiltroGrupo','despFiltroCategoria','despFiltroStatus','despFiltroPrioridade','despFiltroFuncionario','despFiltroVeiculo','despFiltroFornecedor','despFiltroTerceirizado','despBusca'])despEl(id).value='';
    atualizarFiltroCategoria();filtrarContasMes().catch(e=>msg(e.message,'erro'));
  });
  atualizarFiltroCategoria();trocarCadastroDespesa('funcionarios');fecharCadastroDespesa();
}
