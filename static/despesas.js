// Contas a pagar; utiliza as mesmas funções de API e mensagens do painel.
const despCategorias={
  'Custos fixos':['Salários','Encargos trabalhistas','Água','Luz','Telefone','Internet','Aluguel','Contabilidade','Seguros','Sistemas e assinaturas','Impostos e taxas','Outros custos fixos'],
  'Fornecedores':['Mercadorias','Materiais e insumos','Frete','Serviços contratados','Outros fornecedores'],
  'Despesas variáveis':['Manutenção de veículo','Combustível','Adiantamento de funcionário','Reembolso de funcionário','Manutenção da loja','Equipamentos','Material de escritório','Limpeza','Publicidade','Outras despesas variáveis']
};
let despesasMes=[],despCadastros={funcionarios:[],veiculos:[],fornecedores:[],terceirizados:[]},despTipoCadastro='funcionarios';
const despEl=id=>document.getElementById(id);
const despNomes={funcionarios:'Funcionários',veiculos:'Veículos',fornecedores:'Fornecedores',terceirizados:'Terceirizados'};
const despHoje=()=>{const partes=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Fortaleza',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return ['year','month','day'].map(k=>partes.find(p=>p.type===k).value).join('-')};
function despParametros(){
  const params=new URLSearchParams({mes:despEl('despMes').value});
  const campos={despFiltroGrupo:'grupo',despFiltroCategoria:'categoria',despFiltroStatus:'status',despFiltroPrioridade:'prioridade',despFiltroFuncionario:'funcionario_id',despFiltroVeiculo:'veiculo_id',despFiltroFornecedor:'fornecedor_id',despFiltroTerceirizado:'terceirizado_id'};
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
  despEl('despJurosMes').textContent=moeda(r.juros_pagos_mes||0);
  despEl('despContagem').textContent=`${r.quantidade||0} conta(s) · Totais conforme o mês de competência e os filtros.`;
  despEl('despGrupos').innerHTML=Object.entries(r.por_grupo||{}).map(([g,v])=>`<div><span>${escaparFinanceiro(g)}</span><strong>${moeda(v)}</strong></div>`).join('');
  despEl('despExportar').href='/api/exportar/despesas.csv?'+params;
  renderResumoVinculado(r,params);
  renderContasMes();
  despJurosPagina=1;renderJurosPagos();
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
const DESP_POR_PAGINA=5;
let despPagina=1;
function renderContasMes(){
  const total=despesasMes.length;
  const paginas=Math.max(1,Math.ceil(total/DESP_POR_PAGINA));
  despPagina=Math.max(1,Math.min(despPagina,paginas));
  const inicio=(despPagina-1)*DESP_POR_PAGINA;
  despEl('despesasBody').innerHTML=despesasMes.length?despesasMes.slice(inicio,inicio+DESP_POR_PAGINA).map(r=>{
    const vinculos=[r.fornecedor_nome,r.funcionario_nome,r.veiculo_nome,r.terceirizado_nome].filter(Boolean);
    return `<tr><td><strong>${escaparFinanceiro(r.descricao)}</strong><div class="table-sub">${escaparFinanceiro(r.grupo)} · ${escaparFinanceiro(r.categoria)}${r.repetir_mensal?' · Mensal':''}</div>${r.documento?`<div class="table-sub">${escaparFinanceiro(r.documento)}</div>`:''}</td>
      <td>${vinculos.map(v=>`<div class="table-sub">${escaparFinanceiro(v)}</div>`).join('')||'—'}</td>
      <td><span title="${r.urgente_automatico?'Urgente automaticamente: conta vencida':'Prioridade cadastrada'}" class="desp-priority ${escaparFinanceiro(r.prioridade)}">${escaparFinanceiro(r.prioridade)}</span></td>
      <td>${dataBR(r.vencimento)}</td><td>${moeda(r.valor)}${r.juros>0?`<div class="table-sub">Base: ${moeda(r.valor_base)}<br>Juros/acréscimos: ${moeda(r.juros)}</div>`:''}</td>
      <td class="desp-status-cell"><span class="badge ${statusClass(r.status)}">${escaparFinanceiro(r.status)}</span></td>
      <td><div class="desp-payment-cell">${r.pago?`<span class="table-sub">${dataBR(r.data_pagamento)}</span>`:''}<button type="button" class="secondary desp-payment-icon ${r.pago?'desp-reopen':'desp-confirm'}" title="${r.pago?'Reabrir despesa':'Marcar como paga'}" aria-label="${r.pago?'Reabrir despesa':'Marcar como paga'}" onclick="pagarDespesa(${r.id},${!r.pago})"><span aria-hidden="true">${r.pago?'↶':'✓'}</span></button></div></td>
      <td><div class="acoes icon-actions"><button type="button" class="edit icon-btn" aria-label="Editar despesa" title="Editar despesa" onclick="editarDespesa(${r.id})">✎</button><button type="button" class="danger icon-btn" aria-label="Excluir despesa" title="Excluir despesa" onclick="excluirDespesa(${r.id})">🗑</button></div></td></tr>`;
  }).join(''):'<tr><td colspan="8" class="empty">Nenhuma despesa para o mês e os filtros selecionados.</td></tr>';
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
  await carregarCategoriasDespesas();
  for(const [tipo,campo] of [['funcionarios','Funcionario'],['veiculos','Veiculo'],['fornecedores','Fornecedor'],['terceirizados','Terceirizado']]){
    despOpcoes('desp'+campo,tipo);despOpcoes('despFiltro'+campo,tipo,true);
  }
  renderCadastrosDespesas();
}
function despAtualizarCategoria(valor){
  const grupo=despEl('despGrupo').value;
  despEl('despCategoria').innerHTML=despCategorias[grupo].map(c=>`<option>${escaparFinanceiro(c)}</option>`).join('');
  if(valor&&despCategorias[grupo].includes(valor))despEl('despCategoria').value=valor;
  despEl('despFornecedor').required=grupo==='Fornecedores';
  despEl('despRepetirLabel').classList.toggle('hidden',grupo!=='Custos fixos');
  despEl('despRepetir').checked=grupo==='Custos fixos';
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
  despEl('despPrioridade').value=r.prioridade_cadastro||r.prioridade;
  despEl('despRepetir').checked=!!r.repetir_mensal;
  despEl('despPago').checked=r.pago;despAtualizarPago();despEl('despTitulo').textContent='Editar despesa';
}
async function pagarDespesa(id,pago){
  const r=despesasMes.find(x=>x.id===id);if(!r)return;
  let data=null,valor=r.valor;
  if(pago){
    data=prompt('Data do pagamento (AAAA-MM-DD):',despHoje());if(data===null)return;
    {
      const entrada=prompt(`Valor total pago, incluindo juros ou multa (valor base: ${moeda(r.valor_base??r.valor)}). Mantenha o valor se não houver acréscimo:`,Number(r.valor).toFixed(2));
      if(entrada===null)return;
      if(!/^\d+(?:[.,]\d{1,2})?$/.test(entrada.trim())){msg('Informe o valor sem separador de milhar e com até duas casas decimais.','erro');return}
      valor=Number(entrada.trim().replace(',','.'));
      if(valor<Number(r.valor_base??r.valor)){msg('O total deve ser igual ou maior que o valor base.','erro');return}
    }
  }else if(!confirm('Reabrir esta conta? A data de pagamento e os juros serão removidos, restaurando o valor base.'))return;
  try{await api('/api/despesas/'+id+'/status',{method:'PATCH',body:JSON.stringify({pago,data_pagamento:data,valor})});await carregarDespesas();await carregarDespesasDashboard();msg(pago?'Despesa marcada como paga.':'Despesa reaberta.')}catch(e){msg(e.message,'erro')}
}
async function excluirDespesa(id){
  const r=despesasMes.find(x=>x.id===id);
  if(!confirm(r?.repetir_mensal?'Excluir esta despesa e interromper as próximas repetições? Os outros meses já cadastrados serão mantidos.':'Excluir esta despesa?'))return;
  try{await api('/api/despesas/'+id,{method:'DELETE'});await carregarDespesas();await carregarDespesasDashboard();msg('Despesa excluída.')}catch(e){msg(e.message,'erro')}
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
  const campos={
    funcionarios:[['nome','Nome'],['cargo','Cargo'],['data_nascimento','Data de nascimento'],['endereco','Endereço'],['telefone','Telefone']],
    veiculos:[['nome','Nome / modelo'],['placa','Placa'],['ano','Ano'],['observacoes','Observações']],
    fornecedores:[['nome','Nome'],['telefone','Telefone'],['documento','CPF/CNPJ'],['observacoes','Observações']],
    terceirizados:[['nome','Nome'],['telefone','Telefone'],['servico','Serviço / especialidade'],['documento','CPF/CNPJ'],['observacoes','Observações']]
  }[despTipoCadastro];
  const colunas=[...campos.map(([,titulo])=>titulo),'Ações'];
  despEl('despCadHead').innerHTML='<tr>'+colunas.map(c=>`<th scope="col">${c}</th>`).join('')+'</tr>';
  const registros=despCadastros[despTipoCadastro];
  despEl('despCadBody').innerHTML=registros.length?registros.map(r=>{
    const celulas=campos.map(([campo])=>`<td>${campo==='data_nascimento'?dataBR(r[campo]):escaparFinanceiro(String(r[campo]??'')||'—')}</td>`).join('');
    return `<tr>${celulas}<td><div class="acoes"><button type="button" class="secondary" onclick="verDespesasVinculadas(${r.id})">Ver despesas</button><button type="button" class="edit icon-btn" title="Editar cadastro" aria-label="Editar cadastro" onclick="editarCadastroDespesa(${r.id})">✎</button><button type="button" class="danger icon-btn" title="Excluir cadastro" aria-label="Excluir cadastro" onclick="excluirCadastroDespesa(${r.id})">🗑</button></div></td></tr>`;
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
  for(const campo of ['despFiltroGrupo','despFiltroCategoria','despFiltroStatus','despFiltroPrioridade','despFiltroFuncionario','despFiltroVeiculo','despFiltroFornecedor','despFiltroTerceirizado'])despEl(campo).value='';
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
    const payload=Object.fromEntries(Object.entries(campos).map(([k,v])=>[k,despEl('desp'+v).value]));payload.pago=despEl('despPago').checked;payload.repetir_mensal=despEl('despGrupo').value==='Custos fixos'&&despEl('despRepetir').checked;
    try{await api(id?'/api/despesas/'+id:'/api/despesas',{method:id?'PUT':'POST',body:JSON.stringify(payload)});despEl('despMes').value=payload.competencia;fecharCadastroDespesa();await carregarDespesas();await carregarDespesasDashboard();msg(id?'Despesa atualizada.':'Despesa cadastrada.')}catch(e){msg(e.message,'erro')}
  });
  ['despMes','despFiltroGrupo','despFiltroCategoria','despFiltroStatus','despFiltroPrioridade','despFiltroFuncionario','despFiltroVeiculo','despFiltroFornecedor','despFiltroTerceirizado'].forEach(id=>despEl(id).addEventListener('change',()=>{if(id==='despFiltroGrupo')atualizarFiltroCategoria();filtrarContasMes().catch(e=>msg(e.message,'erro'))}));
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
    for(const id of ['despFiltroGrupo','despFiltroCategoria','despFiltroStatus','despFiltroPrioridade','despFiltroFuncionario','despFiltroVeiculo','despFiltroFornecedor','despFiltroTerceirizado'])despEl(id).value='';
    atualizarFiltroCategoria();filtrarContasMes().catch(e=>msg(e.message,'erro'));
  });
  atualizarFiltroCategoria();trocarCadastroDespesa('funcionarios');fecharCadastroDespesa();
}

async function carregarCategoriasDespesas(){
  const dados=await api('/api/despesas/categorias');
  for(const [grupo,nomes] of Object.entries(dados))despCategorias[grupo]=nomes;
  const valor=despEl('despCategoria').value,repetir=despEl('despRepetir').checked;
  despAtualizarCategoria(valor);despEl('despRepetir').checked=repetir;atualizarFiltroCategoria();
}
despEl('despNovaCategoria').addEventListener('click',async()=>{
  const grupo=despEl('despGrupo').value,nome=prompt('Nome da nova categoria em '+grupo+':','');if(nome===null||!nome.trim())return;
  const botao=despEl('despNovaCategoria');botao.disabled=true;
  try{const d=await api('/api/despesas/categorias',{method:'POST',body:JSON.stringify({grupo,nome})});await carregarCategoriasDespesas();if(despEl('despGrupo').value===grupo)despEl('despCategoria').value=d.nome;msg('Categoria disponível para uso.')}catch(e){msg(e.message,'erro')}finally{botao.disabled=false}
});

// Juros pagos: valores já incluídos no pagamento, sem somar novamente às despesas.
let despJurosPagina=1;
function renderJurosPagos(){
  const rows=despesasMes.filter(r=>r.pago&&Number(r.juros)>0);
  const jurosCentavos=rows.reduce((s,r)=>s+Math.round(Number(r.juros)*100),0);
  despEl('despJurosTotal').textContent=moeda(jurosCentavos/100);
  despJurosPagina=Math.max(1,Math.min(despJurosPagina,Math.max(1,Math.ceil(rows.length/5))));
  despEl('despJurosBody').innerHTML=rows.slice((despJurosPagina-1)*5,despJurosPagina*5).map(r=>`<tr><td><strong>${escaparFinanceiro(r.descricao)}</strong><div class="table-sub">${escaparFinanceiro(r.fornecedor_nome||r.categoria||'')}</div></td><td>${dataBR(r.data_pagamento)}</td><td>${moeda(r.valor_base)}</td><td>${moeda(r.valor)}</td><td><strong class="ui-negative">${moeda(r.juros)}</strong></td></tr>`).join('')||'<tr><td colspan="5" class="empty">Nenhum pagamento com juros para o mês e os filtros selecionados.</td></tr>';
  renderPaginacaoTabela('despJuros',despJurosPagina,rows.length,n=>{despJurosPagina=n;renderJurosPagos()});
}
