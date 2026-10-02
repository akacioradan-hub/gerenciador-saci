const moeda=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const dataBR=d=>d?new Date(d+'T12:00:00').toLocaleDateString('pt-BR'):'-';
let clientes=[];
let charts={};

function statusClass(s){return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,'_')}
function msg(texto,tipo='ok'){const el=document.getElementById('mensagem');el.textContent=texto;el.className='mensagem '+tipo;setTimeout(()=>el.className='mensagem',3500)}
async function api(url,op={}){const r=await fetch(url,{headers:{'Content-Type':'application/json'},...op});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.erro||'Erro no servidor');return d}
function mesLabel(ym){if(!ym)return '';const [a,m]=ym.split('-').map(Number);return new Intl.DateTimeFormat('pt-BR',{month:'short',year:'2-digit'}).format(new Date(a,m-1,1)).replace('.','')}
function destroyChart(nome){if(charts[nome]){charts[nome].destroy();delete charts[nome]}}
function chartBase(){return {responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{usePointStyle:true,boxWidth:8,font:{size:12}}},tooltip:{callbacks:{label:c=>`${c.dataset.label||c.label}: ${moeda(c.raw)}`}}}}}

async function carregarClientes(){const q=document.getElementById('buscaCliente').value.trim();clientes=await api('/api/clientes'+(q?'?q='+encodeURIComponent(q):''));renderClientes();preencherClientes()}
async function carregarPagamentos(){const pags=await api('/api/pagamentos');const body=document.getElementById('pagamentosBody');body.innerHTML=pags.length?pags.map((p,i)=>`<tr><td>${i+1}</td><td>${p.cliente_nome}</td><td>${dataBR(p.data)}</td><td>${moeda(p.valor)}</td><td>${p.observacao||'-'}</td><td><button class="danger" onclick="excluirPagamento(${p.id})">Excluir</button></td></tr>`).join(''):'<tr><td colspan="6" class="empty">Nenhum pagamento registrado.</td></tr>'}

function renderGraficos(d){
  destroyChart('carteira');
  charts.carteira=new Chart(document.getElementById('chartCarteira'),{
    type:'doughnut',
    data:{labels:['Recebido','Falta receber'],datasets:[{data:[d.total_recebido,d.saldo_devedor],backgroundColor:['#2d2d31','#f3a19d'],borderWidth:0,hoverOffset:4}]},
    options:{...chartBase(),cutout:'68%',plugins:{...chartBase().plugins,legend:{position:'bottom',labels:{usePointStyle:true,boxWidth:8}}}}
  });

  destroyChart('recebimentos');
  charts.recebimentos=new Chart(document.getElementById('chartRecebimentos'),{
    type:'bar',
    data:{labels:d.recebimentos_mensais.map(x=>mesLabel(x.mes)),datasets:[{label:'Recebido',data:d.recebimentos_mensais.map(x=>x.valor),backgroundColor:'#e10600',borderRadius:7,maxBarThickness:46}]},
    options:{...chartBase(),plugins:{...chartBase().plugins,legend:{display:false}},scales:{x:{grid:{display:false}},y:{beginAtZero:true,grid:{color:'#edf1f5'},ticks:{callback:v=>'R$ '+Number(v).toLocaleString('pt-BR')}}}}
  });

  destroyChart('previsao');
  charts.previsao=new Chart(document.getElementById('chartPrevisao'),{
    type:'bar',
    data:{labels:d.previsao_mensal.map(x=>mesLabel(x.mes)),datasets:[{label:'Previsão de recebimento',data:d.previsao_mensal.map(x=>x.valor),backgroundColor:'#5a5a60',borderRadius:7,maxBarThickness:52}]},
    options:{...chartBase(),plugins:{...chartBase().plugins,legend:{display:false}},scales:{x:{grid:{display:false}},y:{beginAtZero:true,grid:{color:'#edf1f5'},ticks:{callback:v=>'R$ '+Number(v).toLocaleString('pt-BR')}}}}
  });
}

async function carregarDashboard(){
  const d=await api('/api/dashboard');
  document.getElementById('kpiReceber').textContent=moeda(d.total_receber);
  document.getElementById('kpiRecebido').textContent=moeda(d.total_recebido);
  document.getElementById('kpiSaldo').textContent=moeda(d.saldo_devedor);
  document.getElementById('kpiAtraso').textContent=d.clientes_atraso;
  document.getElementById('kpiAtrasadoValor').textContent=moeda(d.valor_atrasado)+' em atraso';
  const pct=d.total_receber>0?(d.total_recebido/d.total_receber)*100:0;
  document.getElementById('kpiPercentual').textContent=pct.toLocaleString('pt-BR',{maximumFractionDigits:1})+'% da carteira';
  document.getElementById('kpiPrevisto').textContent=moeda(d.total_previsto_futuro);
  document.getElementById('statusResumo').innerHTML=Object.entries(d.status).map(([k,v])=>`<div class="status-row"><span>${k}</span><strong>${v}</strong></div>`).join('');
  document.getElementById('dashClientes').innerHTML=d.proximos.length?d.proximos.map(c=>`<tr><td>${c.nome}</td><td>${dataBR(c.previsao)}</td><td>${moeda(c.saldo)}</td><td><span class="badge ${statusClass(c.status)}">${c.status}</span></td></tr>`).join(''):'<tr><td colspan="4" class="empty">Nenhum cliente cadastrado.</td></tr>';
  const aviso=document.getElementById('previsaoAviso');
  if(d.valor_atrasado>0){aviso.textContent=`${moeda(d.valor_atrasado)} em saldos vencidos.`;aviso.classList.remove('hidden')}else{aviso.classList.add('hidden')}
  atualizarAvisos(d);
  renderGraficos(d);
}

function atualizarAvisos(d){
  const badge=document.getElementById('alertBadge');
  const total=Number(d.total_alertas||0);
  badge.textContent=total>99?'99+':total;
  badge.classList.toggle('hidden',total===0);

  const banner=document.getElementById('dueTodayBanner');
  const hoje=d.vencem_hoje||[];
  if(hoje.length){
    const valor=hoje.reduce((s,x)=>s+Number(x.saldo||0),0);
    document.getElementById('dueTodayTitle').textContent=hoje.length===1?'1 cliente com pagamento previsto para hoje':`${hoje.length} clientes com pagamento previsto para hoje`;
    document.getElementById('dueTodayText').textContent=`Total previsto para hoje: ${moeda(valor)}.`;
    banner.classList.remove('hidden');
  }else banner.classList.add('hidden');

  const body=document.getElementById('alertPanelBody');
  let html='';
  if(hoje.length){
    html+='<div class="alert-section-title">Vencem hoje</div>';
    html+=hoje.map(x=>`<div class="alert-item today"><strong>${x.nome}</strong><span>Previsão: hoje</span><span class="alert-value">Saldo: ${moeda(x.saldo)}</span></div>`).join('');
  }
  const atrasados=d.atrasados||[];
  if(atrasados.length){
    html+='<div class="alert-section-title">Em atraso</div>';
    html+=atrasados.map(x=>`<div class="alert-item overdue"><strong>${x.nome}</strong><span>Venceu em ${dataBR(x.previsao)}</span><span class="alert-value">Saldo: ${moeda(x.saldo)}</span></div>`).join('');
  }
  body.innerHTML=html||'<div class="empty">Nenhum vencimento pendente.</div>';
}

function renderClientes(){const body=document.getElementById('clientesBody');body.innerHTML=clientes.length?clientes.map(c=>`<tr><td>${c.id}</td><td>${c.nome}</td><td>${moeda(c.divida)}</td><td>${dataBR(c.previsao)}</td><td>${moeda(c.total_pago)}</td><td>${moeda(c.saldo)}</td><td>${dataBR(c.ultimo_pagamento)}</td><td><span class="badge ${statusClass(c.status)}">${c.status}</span></td><td><div class="acoes"><button class="edit" onclick="editarCliente(${c.id})">Editar</button><button class="danger" onclick="excluirCliente(${c.id})">Excluir</button></div></td></tr>`).join(''):'<tr><td colspan="9" class="empty">Nenhum cliente cadastrado.</td></tr>'}
function preencherClientes(){const sel=document.getElementById('pagCliente');const atual=sel.value;sel.innerHTML='<option value="">Selecione...</option>'+clientes.map(c=>`<option value="${c.id}">${c.nome}</option>`).join('');sel.value=atual}
async function atualizarTudo(){await Promise.all([carregarClientes(),carregarPagamentos(),carregarDashboard()])}

document.getElementById('clienteForm').addEventListener('submit',async e=>{e.preventDefault();const id=document.getElementById('clienteId').value;const body=JSON.stringify({nome:document.getElementById('nomeCliente').value.trim(),divida:Number(document.getElementById('valorDivida').value),previsao:document.getElementById('previsaoPagamento').value||null});try{await api(id?'/api/clientes/'+id:'/api/clientes',{method:id?'PUT':'POST',body});msg(id?'Cliente atualizado.':'Cliente cadastrado.');limparEdicao();await atualizarTudo()}catch(err){msg(err.message,'erro')}})
function editarCliente(id){const c=clientes.find(x=>x.id===id);if(!c)return;document.getElementById('clienteId').value=c.id;document.getElementById('nomeCliente').value=c.nome;document.getElementById('valorDivida').value=c.divida;document.getElementById('previsaoPagamento').value=c.previsao||'';document.getElementById('tituloCliente').textContent='Editar cliente';document.getElementById('cancelarEdicao').classList.remove('hidden');window.scrollTo({top:0,behavior:'smooth'})}
function limparEdicao(){document.getElementById('clienteForm').reset();document.getElementById('clienteId').value='';document.getElementById('tituloCliente').textContent='Cadastrar cliente';document.getElementById('cancelarEdicao').classList.add('hidden')}
document.getElementById('cancelarEdicao').onclick=limparEdicao;
async function excluirCliente(id){if(!confirm('Excluir este cliente e todos os pagamentos vinculados?'))return;try{await api('/api/clientes/'+id,{method:'DELETE'});msg('Cliente excluído.');await atualizarTudo()}catch(err){msg(err.message,'erro')}}

document.getElementById('pagamentoForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/pagamentos',{method:'POST',body:JSON.stringify({cliente_id:Number(document.getElementById('pagCliente').value),data:document.getElementById('pagData').value,valor:Number(document.getElementById('pagValor').value),observacao:document.getElementById('pagObs').value.trim()})});msg('Pagamento registrado.');e.target.reset();document.getElementById('pagData').valueAsDate=new Date();await atualizarTudo()}catch(err){msg(err.message,'erro')}})
async function excluirPagamento(id){if(!confirm('Excluir este pagamento?'))return;try{await api('/api/pagamentos/'+id,{method:'DELETE'});msg('Pagamento excluído.');await atualizarTudo()}catch(err){msg(err.message,'erro')}}

document.getElementById('buscaCliente').addEventListener('input',()=>{clearTimeout(window._b);window._b=setTimeout(carregarClientes,250)})
document.querySelectorAll('.tab-btn').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));btn.classList.add('active');document.getElementById(btn.dataset.tab).classList.add('active');if(btn.dataset.tab==='dashboard')setTimeout(()=>Object.values(charts).forEach(c=>c.resize()),80)}))
document.getElementById('pagData').valueAsDate=new Date();
atualizarTudo().catch(err=>msg(err.message,'erro'));


// Interface administrativa moderna
const hojeFormatado=new Intl.DateTimeFormat('pt-BR',{weekday:'long',day:'2-digit',month:'long'}).format(new Date());
const dataHoje=document.getElementById('dataHoje');if(dataHoje)dataHoje.textContent=hojeFormatado.charAt(0).toUpperCase()+hojeFormatado.slice(1);
const sidebar=document.getElementById('sidebar');
const menuToggle=document.getElementById('menuToggle');
if(menuToggle)menuToggle.addEventListener('click',()=>sidebar.classList.toggle('open'));
document.querySelectorAll('.tab-btn').forEach(btn=>btn.addEventListener('click',()=>{if(window.innerWidth<=820)sidebar.classList.remove('open')}));
function abrirAvisos(){document.getElementById('alertPanel').classList.add('open');document.getElementById('alertOverlay').classList.remove('hidden')}
function fecharAvisos(){document.getElementById('alertPanel').classList.remove('open');document.getElementById('alertOverlay').classList.add('hidden')}
document.getElementById('alertButton')?.addEventListener('click',abrirAvisos);
document.getElementById('openDueAlerts')?.addEventListener('click',abrirAvisos);
document.getElementById('closeAlerts')?.addEventListener('click',fecharAvisos);
document.getElementById('alertOverlay')?.addEventListener('click',fecharAvisos);

// Gestão de usuários (somente administrador)
let usuarios=[];
async function carregarUsuarios(){
  if(!window.IS_ADMIN) return;
  usuarios=await api('/api/usuarios');
  const body=document.getElementById('usuariosBody');
  if(!body) return;
  body.innerHTML=usuarios.length?usuarios.map(u=>`<tr>
    <td>${u.nome}</td><td>${u.username}</td>
    <td><span class="role-badge ${u.role==='admin'?'role-admin':'role-user'}">${u.role==='admin'?'Administrador':'Usuário'}</span></td>
    <td><span class="badge ${u.ativo?'QUITADO':'SEM_PREVISAO'}">${u.ativo?'ATIVO':'INATIVO'}</span></td>
    <td>${u.criado_em?new Date(u.criado_em).toLocaleDateString('pt-BR'):'-'}</td>
    <td><div class="acoes"><button class="edit" onclick="editarUsuario(${u.id})">Editar</button><button class="danger" onclick="excluirUsuario(${u.id})">Excluir</button></div></td>
  </tr>`).join(''):'<tr><td colspan="6" class="empty">Nenhum usuário cadastrado.</td></tr>';
}
function limparUsuario(){
  const f=document.getElementById('usuarioForm');if(!f)return;f.reset();
  document.getElementById('usuarioId').value='';document.getElementById('usuarioAtivo').checked=true;
  document.getElementById('usuarioLogin').disabled=false;document.getElementById('usuarioSenha').required=true;
  document.getElementById('tituloUsuario').textContent='Criar novo usuário';document.getElementById('cancelarUsuario').classList.add('hidden');
}
function editarUsuario(id){
  const u=usuarios.find(x=>x.id===id);if(!u)return;
  document.getElementById('usuarioId').value=u.id;document.getElementById('usuarioNome').value=u.nome;
  document.getElementById('usuarioLogin').value=u.username;document.getElementById('usuarioLogin').disabled=true;
  document.getElementById('usuarioSenha').value='';document.getElementById('usuarioSenha').required=false;
  document.getElementById('usuarioSenha').placeholder='Deixe em branco para manter a senha';
  document.getElementById('usuarioRole').value=u.role;document.getElementById('usuarioAtivo').checked=u.ativo;
  document.getElementById('tituloUsuario').textContent='Editar usuário';document.getElementById('cancelarUsuario').classList.remove('hidden');
}
async function excluirUsuario(id){
  if(!confirm('Excluir este usuário do sistema?'))return;
  try{await api('/api/usuarios/'+id,{method:'DELETE'});msg('Usuário excluído.');await carregarUsuarios()}catch(err){msg(err.message,'erro')}
}
if(window.IS_ADMIN){
  const uf=document.getElementById('usuarioForm');
  if(uf){
    document.getElementById('usuarioSenha').required=true;
    uf.addEventListener('submit',async e=>{e.preventDefault();const id=document.getElementById('usuarioId').value;
      const payload={nome:document.getElementById('usuarioNome').value.trim(),username:document.getElementById('usuarioLogin').value.trim(),senha:document.getElementById('usuarioSenha').value,role:document.getElementById('usuarioRole').value,ativo:document.getElementById('usuarioAtivo').checked};
      try{await api(id?'/api/usuarios/'+id:'/api/usuarios',{method:id?'PUT':'POST',body:JSON.stringify(payload)});msg(id?'Usuário atualizado.':'Usuário criado.');limparUsuario();await carregarUsuarios()}catch(err){msg(err.message,'erro')}
    });
    document.getElementById('cancelarUsuario').onclick=limparUsuario;
    carregarUsuarios().catch(err=>msg(err.message,'erro'));
  }
}
