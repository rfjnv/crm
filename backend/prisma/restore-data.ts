import { PrismaClient, Role } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

// Types for backup data
interface ClientData {
  companyName: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  inn?: string;
}

interface ProductBackup {
  id: string;
  name: string;
  sku: string;
  unit: string;
  format: string | null;
  category: string | null;
  countryOfOrigin: string | null;
  stock: string;
  minStock: string;
  purchasePrice: string | null;
  salePrice: string | null;
  installmentPrice: string | null;
  pricingMode: string;
  specifications: any;
  isActive: boolean;
  manufacturedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DealBackup {
  id: string;
  amount: string;
  paidAmount: string;
  paymentStatus: string;
  clientId: string;
  isArchived: boolean;
  status: string;
  createdAt: string;
}

async function main() {
  try {
    console.log('Starting data restoration...\n');

    // Get manager for clients
    const manager = await prisma.user.findFirst({
      where: { role: Role.MANAGER },
    });

    if (!manager) {
      throw new Error('No manager user found');
    }

    // ========== Restore Clients ==========
    console.log('Restoring clients...');
    const clientsPath = path.join(__dirname, 'clients-data.json');
    const clientsRaw = fs.readFileSync(clientsPath, 'utf-8');
    const clientsData = JSON.parse(clientsRaw) as ClientData[];

    let clientsCount = 0;
    for (const client of clientsData) {
      try {
        const existing = await prisma.client.findFirst({
          where: { companyName: client.companyName }
        });
        
        if (!existing) {
          await prisma.client.create({
            data: {
              companyName: client.companyName,
              contactName: client.contactName || client.companyName,
              phone: client.phone || '',
              email: client.email,
              address: client.address,
              notes: client.notes,
              inn: client.inn,
              managerId: manager.id,
            },
          });
        }
        clientsCount++;
      } catch (e) {
        // Skip duplicates
      }
    }
    console.log(`✓ Restored ${clientsCount} clients\n`);

    // ========== Restore Products ==========
    console.log('Restoring products...');
    const productsPath = path.join(__dirname, '../backups/products-backup-2026-03-02T08-56-01-792Z.json');
    const productsRaw = fs.readFileSync(productsPath, 'utf-8');
    const productsData = JSON.parse(productsRaw) as ProductBackup[];

    let productsCount = 0;
    for (const product of productsData) {
      try {
        const existing = await prisma.product.findFirst({
          where: { sku: product.sku }
        });
        
        if (existing) {
          await prisma.product.update({
            where: { sku: product.sku },
            data: {
              name: product.name,
              unit: product.unit,
              format: product.format,
              category: product.category,
              countryOfOrigin: product.countryOfOrigin,
              stock: product.stock,
              minStock: product.minStock,
              purchasePrice: product.purchasePrice ? parseFloat(product.purchasePrice) : null,
              salePrice: product.salePrice ? parseFloat(product.salePrice) : null,
              installmentPrice: product.installmentPrice ? parseFloat(product.installmentPrice) : null,
              pricingMode: product.pricingMode,
              specifications: product.specifications,
              isActive: product.isActive,
              manufacturedAt: product.manufacturedAt ? new Date(product.manufacturedAt) : null,
              expiresAt: product.expiresAt ? new Date(product.expiresAt) : null,
            },
          });
        } else {
          await prisma.product.create({
            data: {
              id: product.id,
              name: product.name,
              sku: product.sku,
              unit: product.unit,
              format: product.format,
              category: product.category,
              countryOfOrigin: product.countryOfOrigin,
              stock: product.stock,
              minStock: product.minStock,
              purchasePrice: product.purchasePrice ? parseFloat(product.purchasePrice) : null,
              salePrice: product.salePrice ? parseFloat(product.salePrice) : null,
              installmentPrice: product.installmentPrice ? parseFloat(product.installmentPrice) : null,
              pricingMode: product.pricingMode,
              specifications: product.specifications,
              isActive: product.isActive,
              manufacturedAt: product.manufacturedAt ? new Date(product.manufacturedAt) : null,
              expiresAt: product.expiresAt ? new Date(product.expiresAt) : null,
            },
          });
        }
        productsCount++;
      } catch (e: any) {
        console.warn(`  Warning: Could not restore product ${product.sku}: ${e.message}`);
      }
    }
    console.log(`✓ Restored ${productsCount} products\n`);

    // ========== Restore Deals (basic structure only) ==========
    console.log('Restoring deals...');
    const dealsPath = path.join(__dirname, '../backups/deals-2026-03-16-09-45-28.json');
    const dealsRaw = fs.readFileSync(dealsPath, 'utf-8');
    const dealsData = JSON.parse(dealsRaw) as DealBackup[];

    let dealsCount = 0;
    for (const deal of dealsData) {
      try {
        const existing = await prisma.deal.findFirst({
          where: { id: deal.id }
        });
        
        // Verify client exists
        const client = await prisma.client.findFirst({
          where: { id: deal.clientId }
        });
        
        if (!client) {
          continue; // Skip deals with missing clients
        }
        
        if (existing) {
          await prisma.deal.update({
            where: { id: deal.id },
            data: {
              amount: deal.amount,
              paidAmount: deal.paidAmount,
              paymentStatus: deal.paymentStatus as any,
              status: deal.status as any,
              isArchived: deal.isArchived,
            },
          });
        } else {
          await prisma.deal.create({
            data: {
              id: deal.id,
              title: `Deal ${deal.id.substring(0, 8)}`,
              amount: deal.amount,
              paidAmount: deal.paidAmount,
              paymentStatus: deal.paymentStatus as any,
              status: deal.status as any,
              isArchived: deal.isArchived,
              clientId: deal.clientId,
              managerId: manager.id,
              createdAt: new Date(deal.createdAt),
            },
          });
        }
        dealsCount++;
      } catch (e: any) {
        console.warn(`  Warning: Could not restore deal ${deal.id}: ${e.message}`);
      }
    }
    console.log(`✓ Restored ${dealsCount} deals\n`);

    console.log('========================================');
    console.log('✓ Data restoration completed successfully!');
    console.log('========================================');
    console.log(`Summary:`);
    console.log(`  - Clients: ${clientsData.length}`);
    console.log(`  - Products: ${productsCount}`);
    console.log(`  - Deals: ${dealsCount}`);
  } catch (error) {
    console.error('Restoration error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
