"""
Generate monthly cashflow chart from CSV data.
"""
import csv
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import os

reports_dir = os.path.join('C:\\Users\\Noutbuk savdosi\\CRM', 'reports')
csv_path = os.path.join(reports_dir, 'monthly_cashflow.csv')
figs_dir = os.path.join(reports_dir, 'figs')
os.makedirs(figs_dir, exist_ok=True)

months = []
opening = []
closing = []
new_sales = []
payments = []

with open(csv_path, 'r') as f:
    reader = csv.DictReader(f)
    for row in reader:
        months.append(row['month'])
        opening.append(float(row['opening_balance']) / 1e9)
        closing.append(float(row['closing_balance']) / 1e9)
        new_sales.append(float(row['new_sales']) / 1e9)
        payments.append(float(row['payments_received']) / 1e9)

fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(14, 10), gridspec_kw={'height_ratios': [3, 2]})
fig.suptitle('CRM Monthly Cashflow Analysis (Jan 2025 - Feb 2026)', fontsize=14, fontweight='bold')

# Top chart: Opening/Closing balances (debt over time)
ax1.plot(months, opening, 'b-o', label='Opening Balance', linewidth=2, markersize=5)
ax1.plot(months, closing, 'r-s', label='Closing Balance', linewidth=2, markersize=5)
ax1.fill_between(months, opening, closing, alpha=0.1, color='red')
ax1.set_ylabel('Billion UZS')
ax1.set_title('Outstanding Debt (Opening / Closing Balance)')
ax1.legend(loc='upper left')
ax1.grid(True, alpha=0.3)
ax1.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, p: f'{x:.1f}B'))
plt.setp(ax1.xaxis.get_majorticklabels(), rotation=45, ha='right')

# Annotate the Feb 2026 drop
ax1.annotate(f'Sync payments\n→ {closing[-1]:.1f}B',
             xy=(months[-1], closing[-1]),
             xytext=(months[-2], closing[-1] + 1),
             arrowprops=dict(arrowstyle='->', color='red'),
             fontsize=9, color='red', fontweight='bold')

# Bottom chart: Sales vs Payments (monthly flow)
x_pos = range(len(months))
width = 0.35
bars1 = ax2.bar([p - width/2 for p in x_pos], new_sales, width, label='New Sales', color='steelblue', alpha=0.8)
bars2 = ax2.bar([p + width/2 for p in x_pos], payments, width, label='Payments Received', color='green', alpha=0.8)
ax2.set_ylabel('Billion UZS')
ax2.set_title('Monthly Sales vs Payments')
ax2.set_xticks(list(x_pos))
ax2.set_xticklabels(months, rotation=45, ha='right')
ax2.legend(loc='upper left')
ax2.grid(True, alpha=0.3, axis='y')
ax2.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, p: f'{x:.1f}B'))

# Annotate Feb 2026 huge payment
ax2.annotate(f'Sync: {payments[-1]:.1f}B',
             xy=(len(months)-1 + width/2, payments[-1]),
             xytext=(len(months)-3, payments[-1] - 0.5),
             arrowprops=dict(arrowstyle='->', color='green'),
             fontsize=9, color='green', fontweight='bold')

plt.tight_layout()
png_path = os.path.join(figs_dir, 'monthly_cashflow.png')
plt.savefig(png_path, dpi=150, bbox_inches='tight')
print(f'Chart saved: {png_path}')
