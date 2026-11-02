"""Testes da regra de consulta mensal de pendências, sem dependências externas."""
from pathlib import Path
import sqlite3
import unittest

RAIZ = Path(__file__).resolve().parents[1]


class PendenciasMensais(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute('CREATE TABLE despesas(id INTEGER PRIMARY KEY, competencia TEXT, vencimento TEXT, valor NUMERIC, pago INTEGER)')
        self.db.executemany('INSERT INTO despesas VALUES (?, ?, ?, ?, ?)', [
            (1, '2026-10', '2026-10-18', 100, 0), # atraso anterior
            (2, '2026-11', '2026-11-12', 200, 0), # novo mes
            (3, '2026-09', '2026-09-12', 60, 1),  # antigo quitado
            (4, '2026-10', '2026-12-15', 40, 0), # conta anterior a vencer em dezembro
            (5, '2026-12', '2026-12-20', 70, 0), # futuro nao incluido
            (6, '2026-09', '2026-09-20', 80, 0), # atraso de mais de um mes
        ])
        self.db.execute('CREATE TABLE receitas(id INTEGER PRIMARY KEY, unidade TEXT, data TEXT, vencimento TEXT, valor NUMERIC, recebida INTEGER)')
        self.db.executemany('INSERT INTO receitas VALUES (?, ?, ?, ?, ?, ?)', [
            (1,'saci','2026-10-10','2026-10-20',100,0),
            (2,'saci','2026-11-01','2026-11-10',200,0),
            (3,'saci','2026-10-08','2026-10-14',50,1),
            (4,'saci','2026-12-01','2026-12-14',40,0),
            (5,'arcm','2026-10-10','2026-10-20',40,0),
        ])

    def mes_despesas(self, mes, filtro=''):
        y, m = map(int, mes.split('-'))
        fim = f'{y + (m == 12):04d}-{m % 12 + 1:02d}-01'
        sql = '''SELECT id, competencia, vencimento, valor, pago FROM despesas
                 WHERE (competencia = ? OR (competencia < ? AND vencimento < ? AND pago = 0))'''
        if filtro == 'aberto': sql += ' AND pago = 0'
        if filtro == 'atrasado': sql += " AND pago = 0 AND vencimento < '2026-11-02'"
        return self.db.execute(sql, (mes,mes,fim)).fetchall()

    def mes_receitas_saci(self, mes):
        y, m = map(int, mes.split('-'))
        ini = mes + '-01'
        fim = f'{y+(m==12):04d}-{m%12+1:02d}-01'
        return self.db.execute('''SELECT id FROM receitas WHERE unidade = 'saci' AND
           ((data >= ? AND data < ?) OR (data < ? AND vencimento < ? AND recebida = 0))''',
           (ini,fim,ini,fim)).fetchall()

    def test_pendencia_de_outubro_no_mes_seguinte(self):
        ids = [r[0] for r in self.mes_despesas('2026-11')]
        self.assertEqual(ids, [1,2,6])
        self.assertEqual(sum(r[3] for r in self.mes_despesas('2026-11')), 380)

    def test_atrasos_permanecem_em_meses_posteriores(self):
        ids = [r[0] for r in self.mes_despesas('2026-12')]
        self.assertEqual(ids, [1,2,4,5,6])

    def test_nao_antecipa_lancamentos_futuros(self):
        self.assertNotIn(5,[r[0] for r in self.mes_despesas('2026-11')])
        self.assertNotIn(4,[r[0] for r in self.mes_despesas('2026-11')])

    def test_quitacao_retira_somente_da_carteira_posterior(self):
        self.db.execute('UPDATE despesas SET pago = 1 WHERE id = 1')
        self.assertNotIn(1,[r[0] for r in self.mes_despesas('2026-11')])
        self.assertIn(1,[r[0] for r in self.mes_despesas('2026-10')])
        self.db.execute('UPDATE despesas SET pago = 0 WHERE id = 1')
        self.assertIn(1,[r[0] for r in self.mes_despesas('2026-11')])

    def test_filtros(self):
        self.assertEqual({r[0] for r in self.mes_despesas('2026-11','atrasado')},{1,6})
        self.assertEqual({r[0] for r in self.mes_despesas('2026-11','aberto')},{1,2,6})

    def test_receitas_saci_mantem_nao_recebidas(self):
        self.assertEqual([r[0] for r in self.mes_receitas_saci('2026-11')],[1,2])
        self.db.execute('UPDATE receitas SET recebida = 1 WHERE id = 1')
        self.assertEqual([r[0] for r in self.mes_receitas_saci('2026-11')],[2])
        self.assertEqual([r[0] for r in self.mes_receitas_saci('2026-10')],[1,3])

    def test_codigo_contem_mesmas_condicoes(self):
        despesas = (RAIZ/'despesas.py').read_text()
        receitas = (RAIZ/'receitas.py').read_text()
        self.assertIn('Despesa.competencia < competencia',despesas)
        self.assertIn('Despesa.vencimento < fim',despesas)
        self.assertIn('Despesa.pago.is_(False)',despesas)
        self.assertIn('pendencias_anteriores',despesas)
        self.assertIn('Receita.data < inicio',receitas)
        self.assertIn('Receita.recebida.is_(False)',receitas)
        self.assertIn('pendencia_anterior=not r.recebida',receitas)
        self.assertIn('registros = consultar()',despesas) # API e exportacao usam a mesma consulta


if __name__ == '__main__': unittest.main(verbosity=2)
