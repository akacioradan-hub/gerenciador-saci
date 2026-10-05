"""Fluxo de caixa realizado: consulta as origens, sem copiar lançamentos."""
from datetime import date, datetime
from zoneinfo import ZoneInfo
from decimal import Decimal
from flask import request, jsonify
from sqlalchemy import select, union_all, literal, func, case


def registrar_fluxo_caixa(app, db, login_required):
    @app.get('/api/fluxo-caixa/<unidade>')
    @login_required
    def fluxo_saci(unidade):
        if unidade not in ('saci', 'arcm', 'geral'):
            return jsonify(erro='Unidade não encontrada.'), 404
        hoje = datetime.now(ZoneInfo('America/Fortaleza')).date()
        mes = request.args.get('mes') or hoje.strftime('%Y-%m')
        try:
            inicio = date.fromisoformat(mes + '-01')
            fim = date(inicio.year + (inicio.month == 12), inicio.month % 12 + 1, 1)
        except (ValueError, TypeError):
            return jsonify(erro='Informe um mês válido.'), 400
        t = db.metadata.tables
        p, c, o = t['pagamentos'], t['clientes'], t['debitos_orgaos_publicos']
        r, d = t['receitas_unidades'], t['despesas_mensais']

        def movimento(tabela, dia, valor, origem, tipo, descricao, documento, forma, categoria=None):
            return select(tabela.c.id.label('id'), dia.label('data'), valor.label('valor'),
                          literal(origem).label('origem'), literal(tipo).label('tipo'),
                          descricao.label('descricao'), documento.label('documento'), forma.label('forma_pagamento'),
                          (categoria if categoria is not None else literal('')).label('categoria'))

        clientes = movimento(p, p.c.data, p.c.valor, 'clientes', 'entrada', c.c.nome, literal(''), literal('')).select_from(p.join(c, p.c.cliente_id == c.c.id))
        orgaos = movimento(o, o.c.data_recebimento, o.c.valor_debito - func.coalesce(o.c.desconto, 0), 'orgaos', 'entrada', o.c.nome_orgao, o.c.numero_nota_fiscal, literal('')).where(o.c.pago.is_(True))
        manuais = movimento(r, r.c.data_recebimento, r.c.valor, 'manual', 'entrada', r.c.descricao, r.c.documento, r.c.forma_pagamento, r.c.categoria).where(r.c.unidade == 'saci', r.c.recebida.is_(True))
        despesas = movimento(d, d.c.data_pagamento, d.c.valor, 'despesas', 'saida', d.c.descricao, d.c.documento, literal('')).where(d.c.pago.is_(True))
        if unidade == 'arcm':
            rc, contrato = t['clientes_receitas'], t['contratos_receitas_arcm']
            receitas_arcm = movimento(r, r.c.data_recebimento, r.c.valor, 'arcm', 'entrada', r.c.descricao,
                r.c.documento, r.c.forma_pagamento, r.c.categoria).add_columns(rc.c.nome.label('cliente_nome'),
                contrato.c.numero.label('numero_contrato'), r.c.parcela, r.c.cliente_id).select_from(
                    r.outerjoin(rc, r.c.cliente_id == rc.c.id).outerjoin(contrato, r.c.contrato_id == contrato.c.id)
                ).where(r.c.unidade == 'arcm', r.c.recebida.is_(True))
            movimentos = receitas_arcm.subquery()
        elif unidade == 'geral':
            rc = t['clientes_receitas']
            descricao_arcm = func.coalesce(rc.c.nome, '') + literal(' · ') + r.c.descricao
            arcm = movimento(r, r.c.data_recebimento, r.c.valor, 'arcm', 'entrada', descricao_arcm,
                r.c.documento, r.c.forma_pagamento, r.c.categoria).select_from(r.outerjoin(rc, r.c.cliente_id == rc.c.id)
                ).where(r.c.unidade == 'arcm', r.c.recebida.is_(True))
            movimentos = union_all(clientes, orgaos, manuais, arcm, despesas).subquery()
        else:
            movimentos = union_all(clientes, orgaos, manuais, despesas).subquery()
        valido = (movimentos.c.valor > 0) & (movimentos.c.data <= hoje)
        sinal = case((movimentos.c.tipo == 'entrada', movimentos.c.valor), else_=-movimentos.c.valor)
        anterior = db.session.execute(select(func.coalesce(func.sum(sinal), 0)).where(valido, movimentos.c.data < inicio)).scalar_one()
        rows = db.session.execute(select(movimentos).where(valido, movimentos.c.data >= inicio, movimentos.c.data < fim).order_by(movimentos.c.data, movimentos.c.origem, movimentos.c.id)).mappings().all()
        entradas, saidas = Decimal(0), Decimal(0)
        origens = dict(clientes=Decimal(0), orgaos=Decimal(0), manual=Decimal(0), despesas=Decimal(0), arcm=Decimal(0))
        diario = {}
        registros = []
        for row in rows:
            valor = Decimal(str(row['valor']))
            campo = 'entradas' if row['tipo'] == 'entrada' else 'saidas'
            if campo == 'entradas': entradas += valor
            else: saidas += valor
            origens[row['origem']] += valor
            dia = row['data'].isoformat()
            item = diario.setdefault(dia, dict(data=dia, entradas=Decimal(0), saidas=Decimal(0)))
            item[campo] += valor
            registros.append({**dict(row), 'data': dia, 'valor': float(valor)})
        acumulado = Decimal(str(anterior))
        dias = []
        for item in diario.values():
            saldo = item['entradas'] - item['saidas']
            acumulado += saldo
            dias.append(dict(data=item['data'], entradas=float(item['entradas']), saidas=float(item['saidas']), saldo=float(saldo), acumulado=float(acumulado)))
        sem_data = [] if unidade == 'arcm' else db.session.execute(select(o.c.id, o.c.nome_orgao, o.c.numero_nota_fiscal,
            (o.c.valor_debito - func.coalesce(o.c.desconto, 0)).label('valor')).where(o.c.pago.is_(True), o.c.data_recebimento.is_(None)).order_by(o.c.nome_orgao, o.c.id)).mappings().all()
        return jsonify(mes=mes, resumo=dict(entradas=float(entradas), saidas=float(saidas), resultado=float(entradas-saidas),
            saldo_anterior=float(anterior), saldo_final=float(acumulado), origens={k:float(v) for k,v in origens.items()}),
            dias=dias, registros=registros, orgaos_sem_data=[{**dict(row), 'valor':float(row['valor'])} for row in sem_data])
