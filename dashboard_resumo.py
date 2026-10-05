"""Resumo operacional: saldos em aberto e previsão das receitas cadastradas."""
from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo
from flask import request, jsonify
from sqlalchemy import select, func


def registrar_dashboard_resumo(app, db, login_required):
    @app.get('/api/dashboard/resumo')
    @login_required
    def resumo_financeiro():
        hoje = datetime.now(ZoneInfo('America/Fortaleza')).date()
        mes = request.args.get('mes') or hoje.strftime('%Y-%m')
        try:
            inicio = date.fromisoformat(mes + '-01')
            meses = [date(inicio.year + (inicio.month-1+i)//12, (inicio.month-1+i)%12+1, 1).strftime('%Y-%m') for i in range(6)]
        except (ValueError, TypeError):
            return jsonify(erro='Informe um mês válido.'), 400
        t = db.metadata.tables
        c, p = t['clientes'], t['pagamentos']
        pagos = dict(db.session.execute(select(p.c.cliente_id, func.sum(p.c.valor + func.coalesce(p.c.desconto, 0))).group_by(p.c.cliente_id)).all())
        receber = dict(clientes=Decimal(0), orgaos=Decimal(0), saci=Decimal(0), arcm=Decimal(0))
        for r in db.session.execute(select(c.c.id, c.c.divida)).mappings():
            receber['clientes'] += max(Decimal(0), r['divida'] - pagos.get(r['id'], Decimal(0)))
        o = t['debitos_orgaos_publicos']
        receber['orgaos'] = db.session.execute(select(func.coalesce(func.sum(o.c.valor_debito), 0)).where(o.c.pago.is_(False))).scalar_one()
        receitas = t['receitas_unidades']
        previsao = {m:dict(mes=m, saci=Decimal(0), arcm=Decimal(0)) for m in meses}
        for r in db.session.execute(select(receitas.c.unidade, receitas.c.valor, receitas.c.vencimento, receitas.c.recebida)).mappings():
            if r['unidade'] not in ('saci', 'arcm'): continue
            if not r['recebida']: receber[r['unidade']] += r['valor']
            competencia = r['vencimento'].strftime('%Y-%m')
            if competencia in previsao: previsao[competencia][r['unidade']] += r['valor']
        despesas = t['despesas_mensais']
        pagar = {'Custos fixos':Decimal(0), 'Fornecedores':Decimal(0), 'Despesas variáveis':Decimal(0)}
        atraso = Decimal(0)
        for r in db.session.execute(select(despesas.c.grupo, despesas.c.valor, despesas.c.vencimento).where(despesas.c.pago.is_(False))).mappings():
            pagar[r['grupo']] = pagar.get(r['grupo'], Decimal(0)) + r['valor']
            if r['vencimento'] < hoje: atraso += r['valor']
        return jsonify(mes=mes, receber=dict(total=float(sum(receber.values())), origens={k:float(v) for k,v in receber.items()}),
            pagar=dict(total=float(sum(pagar.values())), atrasado=float(atraso), grupos={k:float(v) for k,v in pagar.items()}),
            previsao=[dict(mes=m, saci=float(v['saci']), arcm=float(v['arcm']), total=float(v['saci']+v['arcm'])) for m,v in previsao.items()])
