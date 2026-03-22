import { Modal, List, Spin } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { getOwnerInfo } from '../backend';

interface OwnerInfo {
  uid: string;
  name: string | null;
  email: string | null;
}

interface OwnersModalProps {
  isVisible: boolean;
  setIsVisible: (visible: boolean) => void;
  ownerIds: string[];
}

export function OwnersModal({ isVisible, setIsVisible, ownerIds }: OwnersModalProps) {
  const [owners, setOwners] = useState<OwnerInfo[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isVisible || ownerIds.length === 0) return;
    setLoading(true);
    getOwnerInfo({ ownerIds })
      .then(result => setOwners(result.data.owners))
      .catch(() => setOwners(ownerIds.map(uid => ({ uid, name: null, email: null }))))
      .finally(() => setLoading(false));
  }, [isVisible, ownerIds]);

  return (
    <Modal
      title={`Owners (${ownerIds.length})`}
      open={isVisible}
      onCancel={() => setIsVisible(false)}
      footer={null}
    >
      {loading ? (
        <Spin />
      ) : (
        <List
          dataSource={owners}
          renderItem={owner => (
            <List.Item>
              <List.Item.Meta
                avatar={<UserOutlined />}
                title={owner.name || owner.email || 'Unknown user'}
                description={owner.name && owner.email ? owner.email : undefined}
              />
            </List.Item>
          )}
        />
      )}
    </Modal>
  );
}
