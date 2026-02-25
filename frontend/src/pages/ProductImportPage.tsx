import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Button, Upload, Table, Space, message, Progress, Result, Modal, Typography,
} from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd';
import { productsApi } from '../api/products.api';
import * as XLSX from 'xlsx';

const { Title } = Typography;

interface ParsedProduct {
  rowNum: number;
  name: string;
  format?: string;
  unit: string;
  stock: number;
}

export default function ProductImportPage() {
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [parsedData, setParsedData] = useState<ParsedProduct[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const [resultData, setResultData] = useState<any>(null);
  const queryClient = useQueryClient();

  const importMut = useMutation({
    mutationFn: (file: File) => productsApi.importFromExcel(file),
    onSuccess: (result) => {
      message.success(`Импортировано товаров: ${result.successCount}`);
      if (result.errorCount > 0) {
        message.warning(`Ошибок: ${result.errorCount}`);
      }
      setResultData(result);
      setResultOpen(true);
      setFileList([]);
      setParsedData([]);
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (err: any) => {
      message.error(err.response?.data?.error || 'Ошибка импорта');
    },
  });

  const parseStockValue = (value: unknown): number => {
    if (!value) return 0;
    const str = String(value).trim();
    if (!str) return 0;

    // Extract number from format like "5(kg)", "10.5(m)", etc
    const match = str.match(/^([\d.,]+)/);
    if (!match) return 0;

    const num = parseFloat(match[1].replace(',', '.'));
    return isNaN(num) ? 0 : num;
  };

  const handleFile = (file: File) => {
    try {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];

          if (!sheet) {
            message.error('Excel файл пуст или поврежден');
            return;
          }

          const rows: ParsedProduct[] = [];
          let rowNum = 2;

          for (let i = 2; i <= 1000; i++) {
            const cellB = sheet[`B${i}`];
            const cellC = sheet[`C${i}`];
            const cellD = sheet[`D${i}`];
            const cellH = sheet[`H${i}`];

            // Stop if all cells empty
            if (!cellB && !cellC && !cellD && !cellH) break;

            if (cellB?.v) {
              rows.push({
                rowNum,
                name: String(cellB.v).trim(),
                format: cellC?.v ? String(cellC.v).trim() : undefined,
                unit: String(cellD?.v || 'шт').trim(),
                stock: parseStockValue(cellH?.v),
              });
            }
            rowNum++;
          }

          if (rows.length === 0) {
            message.error('В файле нет данных для импорта');
            return;
          }

          setParsedData(rows);
          setShowPreview(true);
        } catch (err) {
          message.error(`Ошибка чтения файла: ${(err as Error).message}`);
        }
      };
      reader.readAsArrayBuffer(file);
    } catch (err) {
      message.error('Ошибка при обработке файла');
    }

    return false;
  };

  const previewColumns = [
    { title: 'Строка', dataIndex: 'rowNum', width: 80 },
    { title: 'Название', dataIndex: 'name', ellipsis: true },
    { title: 'Размер/Формат', dataIndex: 'format', width: 150 },
    { title: 'Единица', dataIndex: 'unit', width: 100 },
    { title: 'Остаток', dataIndex: 'stock', width: 100 },
  ];

  const errorColumns = [
    { title: 'Строка', dataIndex: 'row', width: 80 },
    { title: 'Ошибка', dataIndex: 'reason', ellipsis: true },
  ];

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 24 }}>
      <Card bordered={false}>
        <Title level={3}>Импорт товаров из Excel</Title>

        {!showPreview ? (
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <div>
              <p>Загрузите Excel файл со следующей структурой:</p>
              <ul>
                <li><strong>Колонка B:</strong> Название товара</li>
                <li><strong>Колонка C:</strong> Размер/Формат</li>
                <li><strong>Колонка D:</strong> Единица измерения</li>
                <li><strong>Колонка H:</strong> Остаток (например: 5(кг), 10.5, и т.д.)</li>
              </ul>
            </div>

            <Upload
              maxCount={1}
              fileList={fileList}
              onChange={({ fileList: newFileList }) => setFileList(newFileList)}
              beforeUpload={(file) => {
                if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
                  message.error('Поддерживаются только файлы Excel (.xlsx, .xls)');
                  return false;
                }
                handleFile(file);
                return false;
              }}
              accept=".xlsx,.xls"
            >
              <Button icon={<UploadOutlined />} size="large">
                Выберите файл Excel
              </Button>
            </Upload>
          </Space>
        ) : (
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <div>
              <h3>Предпросмотр данных ({parsedData.length} товаров)</h3>
              <Table
                dataSource={parsedData}
                columns={previewColumns}
                rowKey={(r) => r.rowNum}
                pagination={{ pageSize: 10 }}
                size="small"
                bordered={false}
              />
            </div>

            <Space>
              <Button onClick={() => {
                setShowPreview(false);
                setParsedData([]);
              }}>
                Назад
              </Button>
              <Button
                type="primary"
                loading={importMut.isPending}
                onClick={() => {
                  if (fileList[0]) {
                    importMut.mutate(fileList[0].originFileObj as File);
                  }
                }}
              >
                Импортировать
              </Button>
            </Space>
          </Space>
        )}
      </Card>

      <Modal
        title="Результат импорта"
        open={resultOpen}
        onClose={() => setResultOpen(false)}
        footer={[
          <Button key="close" onClick={() => setResultOpen(false)}>
            Закрыть
          </Button>,
        ]}
        width={800}
      >
        {resultData && (
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <Result
              status={resultData.errorCount === 0 ? 'success' : 'warning'}
              title={`Импортировано: ${resultData.successCount} товаров`}
              subTitle={resultData.errorCount > 0 ? `Ошибок: ${resultData.errorCount}` : 'Все товары успешно загружены'}
            />

            {resultData.errors && resultData.errors.length > 0 && (
              <div>
                <h4>Ошибки:</h4>
                <Table
                  dataSource={resultData.errors}
                  columns={errorColumns}
                  rowKey={(r) => `${r.row}`}
                  pagination={false}
                  size="small"
                  bordered={false}
                />
              </div>
            )}
          </Space>
        )}
      </Modal>
    </div>
  );
}
