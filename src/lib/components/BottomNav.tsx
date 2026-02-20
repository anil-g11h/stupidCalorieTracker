import React from 'react';
import { useNavigate } from 'react-router-dom';
import { HouseIcon, ListPlusIcon, BowlFoodIcon, BarbellIcon, UserIcon } from '@phosphor-icons/react';
export default function BottomNav() {
    const navigate = useNavigate();
    return (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 flex justify-around">
            <button className="text-gray-600 hover:text-gray-800" onClick={()=>navigate('/')}><HouseIcon /></button>
            <button className="text-gray-600 hover:text-gray-800" onClick={()=>navigate('/log')}><ListPlusIcon /></button>
            <button className="text-gray-600 hover:text-gray-800"><BowlFoodIcon/></button>
            <button className="text-gray-600 hover:text-gray-800"><BarbellIcon/></button>
            <button className="text-gray-600 hover:text-gray-800"><UserIcon/></button>
        </div>
    );
}